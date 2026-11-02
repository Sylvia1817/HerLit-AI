/**
 * Live search adapters.
 *
 * Search results are only *leads*: they must be real http(s) URLs that the safe
 * source fetcher can retrieve. Snippets never satisfy a claim by themselves.
 *
 * Supported protocols:
 * - `brave`   → Brave Search API (GET, X-Subscription-Token)
 * - `tavily`  → Tavily Search API (POST, Bearer)
 * - `serper`  → Serper Google Search API (POST, X-API-KEY)
 * - `generic_json` → original HerLit search protocol (POST {query, limit})
 */

import { OrchestrationError } from "../errors.ts";
import type { EditorialSearchConfig } from "../config.ts";
import type { EditorialSearchAdapter, SearchResult } from "./contracts.ts";
import { providerFetch, readJsonResponse, stageForTask } from "./http.ts";

const DEFAULT_SEARCH_TIMEOUT_MS = 20_000;
const RESULT_LIMIT = 8;

export const DEFAULT_SEARCH_ENDPOINTS = {
  brave: "https://api.search.brave.com/res/v1/web/search",
  tavily: "https://api.tavily.com/search",
  serper: "https://google.serper.dev/search",
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function traceable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeResults(entries: ReadonlyArray<SearchResult>): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const entry of entries) {
    const url = entry.url.trim();
    if (!url || !traceable(url) || seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title: entry.title.trim() || url,
      ...(entry.snippet?.trim() ? { snippet: entry.snippet.trim() } : {}),
    });
    if (results.length >= RESULT_LIMIT) break;
  }
  return results;
}

export type HttpJsonSearchConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function invalidResults(label: string): OrchestrationError {
  return new OrchestrationError({
    stage: "research",
    code: "LIVE_PROVIDER_UNAVAILABLE",
    message: `Search adapter ${label} returned an invalid response`,
    retryable: false,
  }, 503);
}

/** Original HerLit search protocol, kept for existing deployments. */
export class HttpJsonSearchAdapter implements EditorialSearchAdapter {
  readonly id: string;
  private readonly label: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpJsonSearchConfig) {
    this.id = config.provider;
    this.label = config.provider;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async search(query: string): Promise<readonly SearchResult[]> {
    const stage = stageForTask("editorial_research_queries");
    const response = await providerFetch(this.fetchImpl, this.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, limit: 6 }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }, `Search adapter ${this.id}`, stage);
    const payload = record(await readJsonResponse(response, `Search adapter ${this.id}`, stage));
    if (!Array.isArray(payload.results)) throw invalidResults(this.id);
    return normalizeResults(items(payload.results).map((item) => {
      const entry = record(item);
      return { url: text(entry.url), title: text(entry.title), snippet: text(entry.snippet) };
    }));
  }
}

export class BraveSearchAdapter implements EditorialSearchAdapter {
  readonly id: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpJsonSearchConfig) {
    this.id = config.provider;
    this.endpoint = config.baseUrl || DEFAULT_SEARCH_ENDPOINTS.brave;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async search(query: string): Promise<readonly SearchResult[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(RESULT_LIMIT));
    const response = await providerFetch(this.fetchImpl, url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-subscription-token": this.apiKey,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    }, `Search adapter ${this.id}`, "research");
    const payload = record(await readJsonResponse(response, `Search adapter ${this.id}`, "research"));
    return normalizeResults(items(record(payload.web).results).map((item) => {
      const entry = record(item);
      return { url: text(entry.url), title: text(entry.title), snippet: text(entry.description) };
    }));
  }
}

export class TavilySearchAdapter implements EditorialSearchAdapter {
  readonly id: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpJsonSearchConfig) {
    this.id = config.provider;
    this.endpoint = config.baseUrl || DEFAULT_SEARCH_ENDPOINTS.tavily;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async search(query: string): Promise<readonly SearchResult[]> {
    const response = await providerFetch(this.fetchImpl, this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: RESULT_LIMIT,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }, `Search adapter ${this.id}`, "research");
    const payload = record(await readJsonResponse(response, `Search adapter ${this.id}`, "research"));
    if (!Array.isArray(payload.results)) throw invalidResults(this.id);
    return normalizeResults(items(payload.results).map((item) => {
      const entry = record(item);
      return { url: text(entry.url), title: text(entry.title), snippet: text(entry.content) };
    }));
  }
}

export class SerperSearchAdapter implements EditorialSearchAdapter {
  readonly id: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpJsonSearchConfig) {
    this.id = config.provider;
    this.endpoint = config.baseUrl || DEFAULT_SEARCH_ENDPOINTS.serper;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async search(query: string): Promise<readonly SearchResult[]> {
    const response = await providerFetch(this.fetchImpl, this.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ q: query, num: RESULT_LIMIT }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }, `Search adapter ${this.id}`, "research");
    const payload = record(await readJsonResponse(response, `Search adapter ${this.id}`, "research"));
    if (!Array.isArray(payload.organic)) throw invalidResults(this.id);
    return normalizeResults(items(payload.organic).map((item) => {
      const entry = record(item);
      return { url: text(entry.link), title: text(entry.title), snippet: text(entry.snippet) };
    }));
  }
}

export function createSearchAdapter(config: EditorialSearchConfig): EditorialSearchAdapter {
  switch (config.protocol) {
    case "generic_json":
      return new HttpJsonSearchAdapter(config);
    case "brave":
      return new BraveSearchAdapter(config);
    case "tavily":
      return new TavilySearchAdapter(config);
    case "serper":
      return new SerperSearchAdapter(config);
    default: {
      const exhaustive: never = config.protocol;
      throw new Error(`Unsupported search protocol ${String(exhaustive)}`);
    }
  }
}
