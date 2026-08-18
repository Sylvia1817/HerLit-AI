import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";

import { OrchestrationError } from "./errors.ts";

export type FetchedSource = { url: string; contentType: string; text: string };
export type BoundTransportRequest = { url: URL; address: string; timeoutMs: number };
export type BoundTransportResult = { response: Response; connectedAddress: string };
export type BoundFetchTransport = (request: BoundTransportRequest) => Promise<BoundTransportResult>;

export type SafeFetchOptions = {
  transport?: BoundFetchTransport;
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

function ipv4Number(address: string): number | undefined {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inV4Range(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4Number(base)!;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function ipv4Private(address: string): boolean {
  const value = ipv4Number(address);
  if (value === undefined) return true;
  const ranges: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return ranges.some(([base, prefix]) => inV4Range(value, base, prefix));
}

function ipv6Groups(address: string): number[] | undefined {
  let normalized = address.toLowerCase().split("%")[0];
  const dotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const value = ipv4Number(dotted);
    if (value === undefined) return undefined;
    normalized = `${normalized.slice(0, -dotted.length)}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right]
    .map((part) => Number.parseInt(part, 16));
  if (groups.length !== 8 || groups.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return undefined;
  return groups;
}

function ipv6Private(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const mapped = groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
  if (mapped) {
    return ipv4Private(`${groups[6] >>> 8}.${groups[6] & 255}.${groups[7] >>> 8}.${groups[7] & 255}`);
  }
  if (groups.every((part) => part === 0) || (groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1)) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  if ((groups[0] & 0xff00) === 0xff00) return true;
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const plain = address.split("%")[0];
  if (isIP(plain) === 4) return ipv4Private(plain);
  if (isIP(plain) === 6) return ipv6Private(plain);
  return true;
}

function canonicalAddress(address: string): string {
  const plain = address.split("%")[0];
  if (isIP(plain) === 4) return String(ipv4Number(plain));
  const groups = ipv6Groups(plain);
  return groups ? groups.map((part) => part.toString(16).padStart(4, "0")).join(":") : "invalid";
}

function reject(message: string): never {
  throw new OrchestrationError({ stage: "research", code: "SOURCE_URL_BLOCKED", message, retryable: false }, 422);
}

async function defaultResolve(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
}

async function validateUrl(value: string, resolveHost: (hostname: string) => Promise<readonly string[]>): Promise<{ url: URL; addresses: readonly string[] }> {
  let url: URL;
  try { url = new URL(value); } catch { return reject("Source URL is invalid"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") return reject("Only http/https source URLs are allowed");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return reject("localhost source URLs are blocked");
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) return reject("Private or unresolved source addresses are blocked");
  return { url, addresses };
}

const defaultBoundTransport: BoundFetchTransport = ({ url, address, timeoutMs }) => new Promise((resolve, rejectRequest) => {
  const request = (url.protocol === "https:" ? requestHttps : requestHttp)({
    protocol: url.protocol,
    hostname: address,
    port: url.port || undefined,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    headers: { host: url.host, accept: "text/html,text/plain,application/xhtml+xml" },
    servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
  }, (incoming) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        incoming.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        incoming.on("end", () => controller.close());
        incoming.on("error", (error) => controller.error(error));
      },
      cancel() { incoming.destroy(); },
    });
    const status = incoming.statusCode ?? 502;
    resolve({
      response: new Response(status === 204 || status === 304 ? null : body, { status, headers }),
      connectedAddress: incoming.socket.remoteAddress ?? "",
    });
  });
  request.setTimeout(timeoutMs, () => {
    const error = new Error("Source fetch timed out");
    error.name = "TimeoutError";
    request.destroy(error);
  });
  request.on("error", rejectRequest);
  request.end();
});

export function createSafeSourceFetcher(options: SafeFetchOptions = {}) {
  const transport = options.transport ?? defaultBoundTransport;
  const resolveHost = options.resolveHost ?? defaultResolve;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const maxRedirects = options.maxRedirects ?? 3;

  return async function safeFetchSource(input: string): Promise<FetchedSource> {
    let current = input;
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const { url, addresses } = await validateUrl(current, resolveHost);
      const address = addresses[0];
      let result: BoundTransportResult;
      try { result = await transport({ url, address, timeoutMs }); }
      catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new OrchestrationError({ stage: "research", code: timeout ? "SOURCE_FETCH_TIMEOUT" : "SOURCE_FETCH_FAILED", message: timeout ? "Source fetch timed out" : "Source fetch failed", retryable: true }, 422);
      }
      if (isPrivateAddress(result.connectedAddress) || canonicalAddress(result.connectedAddress) !== canonicalAddress(address)) {
        return reject("Source connection address changed after validation");
      }
      const response = result.response;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === maxRedirects) return reject("Unsafe or excessive source redirect");
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) {
        throw new OrchestrationError({ stage: "research", code: "SOURCE_FETCH_FAILED", message: `Source returned HTTP ${response.status}`, retryable: response.status >= 500 || response.status === 408 || response.status === 429 }, 422);
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
      if (!new Set(["text/html", "text/plain", "application/xhtml+xml"]).has(contentType)) return reject(`Unsupported source content type ${contentType || "unknown"}`);
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
