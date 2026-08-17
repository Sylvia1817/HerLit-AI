import type {
  CardPlan,
  DraftBlock,
  DraftTitle,
  EditorialIssue,
  GrowthNotes,
  ValueModule,
} from "../../types/editorial.ts";
import { OrchestrationError } from "./errors.ts";

export interface JsonModelAdapter {
  readonly id: string;
  generateJson<T>(task: string, input: unknown): Promise<T>;
}

export type SearchResult = { url: string; title: string; snippet?: string };

export interface EditorialSearchAdapter {
  readonly id: string;
  search(query: string): Promise<readonly SearchResult[]>;
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new OrchestrationError({
      stage: "selection",
      code: "LIVE_PROVIDER_UNAVAILABLE",
      message: `${label} returned HTTP ${response.status}`,
      retryable: response.status >= 500,
    }, 503);
  }
  return response.json();
}

export class HttpJsonModelAdapter implements JsonModelAdapter {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: { provider: string; baseUrl: string; apiKey: string; model: string }) {
    this.id = config.provider;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generateJson<T>(task: string, input: unknown): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: this.model, task, input, responseFormat: "json" }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await responseJson(response, `Model adapter ${this.id}`) as { data?: T } | T;
    return ((payload as { data?: T }).data ?? payload) as T;
  }
}

export class HttpJsonSearchAdapter implements EditorialSearchAdapter {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: { provider: string; baseUrl: string; apiKey: string }) {
    this.id = config.provider;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  async search(query: string): Promise<readonly SearchResult[]> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, limit: 6 }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await responseJson(response, `Search adapter ${this.id}`) as {
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
