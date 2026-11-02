import { OrchestrationError } from "./errors.ts";
import type { EditorialProviderMode } from "./types.ts";

export const MODEL_PROTOCOLS = ["generic_json", "openai_chat", "anthropic_messages"] as const;
export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number];

export const SEARCH_PROTOCOLS = ["generic_json", "brave", "tavily", "serper"] as const;
export type SearchProtocol = (typeof SEARCH_PROTOCOLS)[number];

export type JsonMode = "auto" | "on" | "off";
const JSON_MODES: readonly JsonMode[] = ["auto", "on", "off"];

export type EditorialModelConfig = {
  provider: string;
  protocol: ModelProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxAttempts: number;
  jsonMode: JsonMode;
  maxOutputTokens?: number;
};

export type EditorialSearchConfig = {
  provider: string;
  protocol: SearchProtocol;
  /** Empty for vendors with a fixed public endpoint. */
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

export type EditorialRuntimeConfig = {
  mode: EditorialProviderMode;
  model?: EditorialModelConfig;
  search?: EditorialSearchConfig;
};

function missing(name: string): OrchestrationError {
  return new OrchestrationError({
    stage: "selection",
    code: "LIVE_PROVIDER_UNAVAILABLE",
    message: `Live mode requires ${name}`,
    retryable: false,
  }, 503);
}

/**
 * Catch the mistake this adapter layer exists to prevent: pasting a vendor
 * endpoint into the generic JSON protocol and assuming it will work.
 */
function assertProtocolMatchesBaseUrl(
  protocol: string,
  baseUrl: string,
  protocolVariable: string,
  expected: string,
): void {
  if (protocol !== "generic_json") return;
  const looksVendorSpecific = /\/(chat\/completions|completions|messages|v1|v1\/messages)$/i.test(baseUrl) ||
    /api\.(openai|anthropic|deepseek|moonshot|tavily|brave)\./i.test(baseUrl) ||
    /google\.serper\.dev/i.test(baseUrl);
  if (!looksVendorSpecific) return;
  throw new OrchestrationError({
    stage: "selection",
    code: "LIVE_PROVIDER_CONFIG_MISMATCH",
    message: `${protocolVariable} is still generic_json but the base URL points at a vendor endpoint; set ${protocolVariable}=${expected}`,
    retryable: false,
    details: { protocolVariable, expected },
  }, 503);
}

export function loadEditorialRuntimeConfig(env: NodeJS.ProcessEnv = process.env): EditorialRuntimeConfig {
  const mode = env.EDITORIAL_PROVIDER_MODE === "live" ? "live" : "mock";
  if (mode === "mock") return { mode };

  const read = (name: string): string | undefined => env[name]?.trim() || undefined;
  const required = (name: string): string => {
    const value = read(name);
    if (!value) throw missing(name);
    return value;
  };
  const protocolFrom = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const raw = read(name);
    if (!raw) return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    throw new OrchestrationError({
      stage: "selection",
      code: "LIVE_PROVIDER_CONFIG_INVALID",
      message: `${name} must be one of ${allowed.join(", ")}`,
      retryable: false,
      details: { name, allowed },
    }, 503);
  };
  const numberFrom = (name: string, fallback: number, min: number, max: number): number => {
    const raw = read(name);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new OrchestrationError({
        stage: "selection",
        code: "LIVE_PROVIDER_CONFIG_INVALID",
        message: `${name} must be an integer between ${min} and ${max}`,
        retryable: false,
        details: { name },
      }, 503);
    }
    return parsed;
  };

  const modelProtocol = protocolFrom("EDITORIAL_MODEL_PROTOCOL", MODEL_PROTOCOLS, "generic_json");
  const searchProtocol = protocolFrom("EDITORIAL_SEARCH_PROTOCOL", SEARCH_PROTOCOLS, "generic_json");

  const modelBaseUrl = required("EDITORIAL_MODEL_BASE_URL");
  assertProtocolMatchesBaseUrl(modelProtocol, modelBaseUrl, "EDITORIAL_MODEL_PROTOCOL", "openai_chat");

  const searchBaseUrl = read("EDITORIAL_SEARCH_BASE_URL") ?? "";
  if (searchProtocol === "generic_json" && !searchBaseUrl) throw missing("EDITORIAL_SEARCH_BASE_URL");
  if (searchBaseUrl) {
    assertProtocolMatchesBaseUrl(searchProtocol, searchBaseUrl, "EDITORIAL_SEARCH_PROTOCOL", "brave");
  }

  return {
    mode,
    model: {
      provider: required("EDITORIAL_MODEL_PROVIDER"),
      protocol: modelProtocol,
      baseUrl: modelBaseUrl,
      apiKey: required("EDITORIAL_MODEL_API_KEY"),
      model: required("EDITORIAL_MODEL_NAME"),
      timeoutMs: numberFrom("EDITORIAL_MODEL_TIMEOUT_MS", 120_000, 1_000, 600_000),
      maxAttempts: numberFrom("EDITORIAL_MODEL_ATTEMPTS", 2, 1, 3),
      jsonMode: protocolFrom("EDITORIAL_MODEL_JSON_MODE", JSON_MODES, "auto"),
      maxOutputTokens: read("EDITORIAL_MODEL_MAX_OUTPUT_TOKENS")
        ? numberFrom("EDITORIAL_MODEL_MAX_OUTPUT_TOKENS", 8_000, 256, 64_000)
        : undefined,
    },
    search: {
      provider: required("EDITORIAL_SEARCH_PROVIDER"),
      protocol: searchProtocol,
      baseUrl: searchBaseUrl,
      apiKey: required("EDITORIAL_SEARCH_API_KEY"),
      timeoutMs: numberFrom("EDITORIAL_SEARCH_TIMEOUT_MS", 20_000, 1_000, 120_000),
    },
  };
}
