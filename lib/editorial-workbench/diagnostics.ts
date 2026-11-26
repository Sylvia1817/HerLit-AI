/**
 * Secret-free runtime diagnostics for the live provider setup.
 *
 * The workbench needs to tell an editor *which* service is missing without
 * ever returning a credential, a full query string or an upstream body.
 */

import { loadEditorialRuntimeConfig, MODEL_PROTOCOLS, SEARCH_PROTOCOLS } from "./config.ts";
import { DEFAULT_SEARCH_ENDPOINTS } from "./live/search-adapters.ts";
import { OrchestrationError } from "./errors.ts";
import type { EditorialProviderMode } from "./types.ts";

export type ProviderDiagnostics = {
  mode: EditorialProviderMode;
  ready: boolean;
  model?: {
    provider: string;
    protocol: string;
    model: string;
    host?: string;
    timeoutMs: number;
  };
  search?: {
    provider: string;
    protocol: string;
    host?: string;
    timeoutMs: number;
  };
  missing: string[];
  issues: Array<{ code: string; message: string }>;
};

const BASE_ENV = [
  "EDITORIAL_MODEL_PROVIDER",
  "EDITORIAL_MODEL_BASE_URL",
  "EDITORIAL_MODEL_API_KEY",
  "EDITORIAL_MODEL_NAME",
  "EDITORIAL_SEARCH_PROVIDER",
  "EDITORIAL_SEARCH_API_KEY",
];

function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function searchHost(protocol: string, baseUrl: string | undefined): string | undefined {
  if (baseUrl) return hostOf(baseUrl);
  if (protocol === "brave") return hostOf(DEFAULT_SEARCH_ENDPOINTS.brave);
  if (protocol === "tavily") return hostOf(DEFAULT_SEARCH_ENDPOINTS.tavily);
  if (protocol === "serper") return hostOf(DEFAULT_SEARCH_ENDPOINTS.serper);
  return undefined;
}

export function describeEditorialRuntime(env: NodeJS.ProcessEnv = process.env): ProviderDiagnostics {
  const mode = env.EDITORIAL_PROVIDER_MODE === "live" ? "live" : "mock";
  if (mode === "mock") {
    return { mode, ready: true, missing: [], issues: [] };
  }

  const missing = BASE_ENV.filter((name) => !env[name]?.trim());
  const searchProtocol = (env.EDITORIAL_SEARCH_PROTOCOL ?? "generic_json").trim();
  if (!env.EDITORIAL_SEARCH_BASE_URL?.trim() && searchProtocol === "generic_json") {
    missing.push("EDITORIAL_SEARCH_BASE_URL");
  }

  try {
    const config = loadEditorialRuntimeConfig(env);
    return {
      mode,
      ready: true,
      model: config.model && {
        provider: config.model.provider,
        protocol: config.model.protocol,
        model: config.model.model,
        host: hostOf(config.model.baseUrl),
        timeoutMs: config.model.timeoutMs,
      },
      search: config.search && {
        provider: config.search.provider,
        protocol: config.search.protocol,
        host: searchHost(config.search.protocol, config.search.baseUrl),
        timeoutMs: config.search.timeoutMs,
      },
      missing: [],
      issues: [],
    };
  } catch (error) {
    const issue = error instanceof OrchestrationError
      ? { code: error.code, message: error.message }
      : { code: "LIVE_PROVIDER_CONFIG_INVALID", message: "Live provider configuration could not be loaded" };
    return {
      mode,
      ready: false,
      model: env.EDITORIAL_MODEL_PROVIDER && env.EDITORIAL_MODEL_BASE_URL && env.EDITORIAL_MODEL_NAME
        ? {
            provider: env.EDITORIAL_MODEL_PROVIDER.trim(),
            protocol: env.EDITORIAL_MODEL_PROTOCOL?.trim() || "generic_json",
            model: env.EDITORIAL_MODEL_NAME.trim(),
            host: hostOf(env.EDITORIAL_MODEL_BASE_URL),
            timeoutMs: Number(env.EDITORIAL_MODEL_TIMEOUT_MS ?? 120_000),
          }
        : undefined,
      search: env.EDITORIAL_SEARCH_PROVIDER
        ? {
            provider: env.EDITORIAL_SEARCH_PROVIDER.trim(),
            protocol: searchProtocol,
            host: searchHost(searchProtocol, env.EDITORIAL_SEARCH_BASE_URL),
            timeoutMs: Number(env.EDITORIAL_SEARCH_TIMEOUT_MS ?? 20_000),
          }
        : undefined,
      missing,
      issues: [issue],
    };
  }
}

export const SUPPORTED_PROTOCOLS = {
  model: MODEL_PROTOCOLS,
  search: SEARCH_PROTOCOLS,
} as const;
