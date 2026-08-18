import type {
  CardPlan,
  DraftBlock,
  DraftTitle,
  EditorialIssue,
  GrowthNotes,
  ValueModule,
} from "../../types/editorial.ts";
import { OrchestrationError } from "./errors.ts";
import type { EditorialStage } from "./types.ts";

export interface JsonModelAdapter {
  readonly id: string;
  generateJson<T>(task: string, input: unknown): Promise<T>;
}

export type SearchResult = { url: string; title: string; snippet?: string };

export interface EditorialSearchAdapter {
  readonly id: string;
  search(query: string): Promise<readonly SearchResult[]>;
}

function stageForTask(task: string): EditorialStage {
  if (task === "editorial_candidate_discovery") return "selection";
  if (task === "editorial_research_queries" || task === "editorial_claim_extraction") return "research";
  if (task === "editorial_growth_review") return "review";
  return "production";
}

async function responseJson(response: Response, label: string, stage: EditorialStage): Promise<unknown> {
  if (!response.ok) {
    throw new OrchestrationError({
      stage,
      code: "LIVE_PROVIDER_UNAVAILABLE",
      message: `${label} returned HTTP ${response.status}`,
      retryable: response.status >= 500 || response.status === 408 || response.status === 429,
    }, 503);
  }
  try {
    return await response.json();
  } catch {
    throw new OrchestrationError({
      stage,
      code: "LIVE_PROVIDER_INVALID_RESPONSE",
      message: `${label} returned invalid JSON`,
      retryable: false,
    }, 502);
  }
}

async function providerFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  label: string,
  stage: EditorialStage,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new OrchestrationError({
      stage,
      code: timeout ? "LIVE_PROVIDER_TIMEOUT" : "LIVE_PROVIDER_UNAVAILABLE",
      message: `${label} ${timeout ? "timed out" : "request failed"}`,
      retryable: true,
    }, 503);
  }
}

export class HttpJsonModelAdapter implements JsonModelAdapter {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: { provider: string; baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }) {
    this.id = config.provider;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateJson<T>(task: string, input: unknown): Promise<T> {
    const stage = stageForTask(task);
    const response = await providerFetch(this.fetchImpl, this.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: this.model, task, input, responseFormat: "json" }),
      signal: AbortSignal.timeout(30_000),
    }, `Model adapter ${this.id}`, stage);
    const payload = await responseJson(response, `Model adapter ${this.id}`, stage) as { data?: T } | T;
    return ((payload as { data?: T }).data ?? payload) as T;
  }
}

export class HttpJsonSearchAdapter implements EditorialSearchAdapter {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: { provider: string; baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.id = config.provider;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async search(query: string): Promise<readonly SearchResult[]> {
    const response = await providerFetch(this.fetchImpl, this.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, limit: 6 }),
      signal: AbortSignal.timeout(15_000),
    }, `Search adapter ${this.id}`, "research");
    const payload = await responseJson(response, `Search adapter ${this.id}`, "research") as {
      results?: SearchResult[];
    };
    if (!Array.isArray(payload.results)) {
      throw new OrchestrationError({
        stage: "research",
        code: "LIVE_PROVIDER_UNAVAILABLE",
        message: `Search adapter ${this.id} returned an invalid response`,
        retryable: false,
      }, 503);
    }
    return payload.results;
  }
}

export type LiveWriterPayload = {
  titles: DraftTitle[];
  blocks: DraftBlock[];
  hashtags: string[];
  cards: CardPlan[];
  readerHook: string;
  editorialAngle: string;
  status: "draft";
};

export type LiveReviewPayload = {
  growthNotes: GrowthNotes;
  issues: EditorialIssue[];
  recommendation: "ready_for_human_review" | "needs_revision";
  status: "draft";
};

export type LiveValuePayload = { modules: ValueModule[] };
