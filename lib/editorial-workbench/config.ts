import { OrchestrationError } from "./errors.ts";
import type { EditorialProviderMode } from "./types.ts";

export type EditorialRuntimeConfig = {
  mode: EditorialProviderMode;
  model?: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  search?: {
    provider: string;
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

export function loadEditorialRuntimeConfig(): EditorialRuntimeConfig {
  const mode = process.env.EDITORIAL_PROVIDER_MODE === "live" ? "live" : "mock";
  if (mode === "mock") return { mode };
  return {
    mode,
    model: {
      provider: required("EDITORIAL_MODEL_PROVIDER"),
      baseUrl: required("EDITORIAL_MODEL_BASE_URL"),
      apiKey: required("EDITORIAL_MODEL_API_KEY"),
      model: required("EDITORIAL_MODEL_NAME"),
    },
    search: {
      provider: required("EDITORIAL_SEARCH_PROVIDER"),
      baseUrl: required("EDITORIAL_SEARCH_BASE_URL"),
      apiKey: required("EDITORIAL_SEARCH_API_KEY"),
    },
  };
}
