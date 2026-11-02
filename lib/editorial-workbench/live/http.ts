/**
 * Shared transport helpers for live provider adapters.
 *
 * Every failure is normalized into an OrchestrationError that keeps the real
 * editorial stage, never echoes a provider response body and never includes
 * credentials. Provider dashboards remain the place to inspect upstream
 * payloads.
 */

import { OrchestrationError } from "../errors.ts";
import type { EditorialStage } from "../types.ts";

export type ProviderFetch = typeof fetch;

const TASK_STAGES: Record<string, EditorialStage> = {
  editorial_candidate_discovery: "selection",
  editorial_research_queries: "research",
  editorial_claim_extraction: "research",
  editorial_growth_review: "review",
};

export function stageForTask(task: string): EditorialStage {
  return TASK_STAGES[task] ?? "production";
}

function requestId(response: Response): string | undefined {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("x-amzn-requestid") ??
    undefined
  );
}

export function statusError(
  response: Response,
  label: string,
  stage: EditorialStage,
): OrchestrationError {
  const { status } = response;
  const details = { status, requestId: requestId(response) };
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;

  if (status === 401 || status === 403) {
    return new OrchestrationError({
      stage,
      code: "LIVE_PROVIDER_UNAUTHORIZED",
      message: `${label} rejected the configured credential (HTTP ${status})`,
      retryable: false,
      details,
    }, 503);
  }
  if (status === 404) {
    return new OrchestrationError({
      stage,
      code: "LIVE_PROVIDER_ENDPOINT_NOT_FOUND",
      message: `${label} endpoint was not found (HTTP 404); check the configured base URL`,
      retryable: false,
      details,
    }, 503);
  }
  if (retryable) {
    return new OrchestrationError({
      stage,
      code: "LIVE_PROVIDER_UNAVAILABLE",
      message: `${label} returned HTTP ${status}`,
      retryable: true,
      details,
    }, 503);
  }
  return new OrchestrationError({
    stage,
    code: "LIVE_PROVIDER_REJECTED",
    message: `${label} rejected the request (HTTP ${status})`,
    retryable: false,
    details,
  }, 502);
}

export async function providerFetch(
  fetchImpl: ProviderFetch,
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

export async function readJsonResponse(
  response: Response,
  label: string,
  stage: EditorialStage,
): Promise<unknown> {
  if (!response.ok) throw statusError(response, label, stage);
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

export function invalidResponse(
  label: string,
  stage: EditorialStage,
  message: string,
): OrchestrationError {
  return new OrchestrationError({
    stage,
    code: "LIVE_PROVIDER_INVALID_RESPONSE",
    message: `${label} ${message}`,
    retryable: false,
  }, 502);
}

/**
 * Models wrap JSON in prose or code fences even when instructed not to.
 * Extract the first balanced JSON object/array without trusting the wrapper.
 */
export function extractJsonValue(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.search(/[{\[]/);
  if (start < 0) return undefined;
  const open = candidate[start];
  if (open !== "{" && open !== "[") return undefined;
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, index + 1);
    }
  }
  return undefined;
}
