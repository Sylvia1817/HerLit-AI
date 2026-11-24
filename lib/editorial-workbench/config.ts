import { OrchestrationError } from "./errors.ts";
import type { EditorialProviderMode } from "./types.ts";

export type EditorialRuntimeConfig = {
  mode: EditorialProviderMode;
  model?: {
    provider: "openai-responses";
    baseUrl: string;
    apiKey: string;
    model: string;
    maxOutputTokens: number;
  };
  search?: {
    provider: "tavily-search";
    baseUrl: string;
    apiKey: string;
  };
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new OrchestrationError({
      stage: "selection",
      code: "LIVE_PROVIDER_UNAVAILABLE",
      message: `Live mode requires ${name}`,
      retryable: false,
    }, 503);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new OrchestrationError({
      stage: "selection",
      code: "LIVE_PROVIDER_UNAVAILABLE",
      message: `${name} must be a positive integer`,
      retryable: false,
    }, 503);
  }
  return value;
}

export function loadEditorialRuntimeConfig(): EditorialRuntimeConfig {
  const mode = process.env.EDITORIAL_PROVIDER_MODE === "live" ? "live" : "mock";
  if (mode === "mock") return { mode };
  return {
    mode,
    model: {
      provider: "openai-responses",
      baseUrl: process.env.OPENAI_RESPONSES_BASE_URL?.trim() || "https://api.openai.com/v1/responses",
      apiKey: required("OPENAI_API_KEY"),
      model: required("OPENAI_MODEL"),
      maxOutputTokens: positiveInteger("OPENAI_MAX_OUTPUT_TOKENS", 6_000),
    },
    search: {
      provider: "tavily-search",
      baseUrl: process.env.TAVILY_SEARCH_BASE_URL?.trim() || "https://api.tavily.com/search",
      apiKey: required("TAVILY_API_KEY"),
    },
  };
}
