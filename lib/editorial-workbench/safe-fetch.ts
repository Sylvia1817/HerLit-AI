import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { OrchestrationError } from "./errors.ts";

export type FetchedSource = {
  url: string;
  contentType: string;
  text: string;
};

export type SafeFetchOptions = {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

function ipv4Private(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function ipv6Private(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? ipv4Private(mapped) : false;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4Private(address);
  if (version === 6) return ipv6Private(address);
  return true;
}

function reject(message: string): never {
  throw new OrchestrationError({
    stage: "research",
    code: "SOURCE_URL_BLOCKED",
    message,
    retryable: false,
  }, 422);
}

async function defaultResolve(hostname: string): Promise<readonly string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(({ address }) => address);
}

async function validateUrl(
  value: string,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return reject("Source URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject("Only http/https source URLs are allowed");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return reject("localhost source URLs are blocked");
  }
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    return reject("Private or unresolved source addresses are blocked");
  }
  return url;
}

export function createSafeSourceFetcher(options: SafeFetchOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHost = options.resolveHost ?? defaultResolve;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const maxRedirects = options.maxRedirects ?? 3;

  return async function safeFetchSource(input: string): Promise<FetchedSource> {
    let current = input;
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const url = await validateUrl(current, resolveHost);
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "text/html,text/plain,application/xhtml+xml" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === maxRedirects) return reject("Unsafe or excessive source redirect");
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) {
        throw new OrchestrationError({
          stage: "research",
          code: "SOURCE_FETCH_FAILED",
          message: `Source returned HTTP ${response.status}`,
          retryable: response.status >= 500,
        }, 422);
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
      if (!new Set(["text/html", "text/plain", "application/xhtml+xml"]).has(contentType)) {
        return reject(`Unsupported source content type ${contentType || "unknown"}`);
      }
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes) return reject("Source response exceeds size limit");
      const reader = response.body?.getReader();
      if (!reader) return { url: url.toString(), contentType, text: "" };
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) return reject("Source response exceeds size limit");
        chunks.push(value);
      }
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return { url: url.toString(), contentType, text: new TextDecoder().decode(body) };
    }
    return reject("Source redirect validation failed");
  };
}
