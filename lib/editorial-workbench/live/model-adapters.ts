/**
 * Live model adapters.
 *
 * The original `generic_json` protocol posts `{model, task, input}` to a
 * service that already knows HerLit's task prompts. Real vendors do not speak
 * that protocol, so this module adds explicit protocol adapters instead of
 * pretending any model URL is drop-in compatible:
 *
 * - `openai_chat`      → POST {base}/chat/completions (OpenAI, DeepSeek,
 *                        Moonshot, Qwen, Zhipu, OpenRouter, vLLM, Ollama …)
 * - `anthropic_messages` → POST {base}/v1/messages
 * - `generic_json`     → the original HerLit JSON task protocol
 *
 * Every structured task goes through the same pipeline: task prompt → JSON
 * extraction → deterministic normalization → one repair attempt that feeds the
 * violated constraints back to the model.
 */

import { OrchestrationError } from "../errors.ts";
import type { EditorialStage } from "../types.ts";
import type { EditorialModelConfig, JsonMode } from "../config.ts";
import type { JsonModelAdapter } from "./contracts.ts";
import {
  extractJsonValue,
  invalidResponse,
  providerFetch,
  readJsonResponse,
  stageForTask,
  statusError,
} from "./http.ts";
import { normalizeTaskPayload } from "./normalize.ts";
import { buildTaskPrompt, isModelTask, taskOutputBudget, TaskContractError } from "./tasks.ts";
import type { ModelTask, PromptPair } from "./tasks.ts";

const DEFAULT_MODEL_TIMEOUT_MS = 120_000;
const DEFAULT_ATTEMPTS = 2;


type StructuredRequest = {
  label: string;
  task: ModelTask;
  input: unknown;
  maxAttempts: number;
  send: (prompt: PromptPair, violations: readonly string[] | undefined) => Promise<string>;
};

function parseJsonOutput(value: string, label: string, stage: EditorialStage): unknown {
  const json = extractJsonValue(value);
  if (!json) throw invalidResponse(label, stage, "returned no JSON object");
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw invalidResponse(label, stage, "returned malformed or truncated JSON");
  }
}

function contractError(error: TaskContractError, label: string, stage: EditorialStage): OrchestrationError {
  return new OrchestrationError({
    stage,
    code: "LIVE_CONTENT_CONTRACT_VIOLATION",
    message: `${label} output did not satisfy the ${error.task} editorial contract`,
    retryable: false,
    details: { violations: [...error.violations] },
  }, 422);
}

async function runStructuredTask<T>(request: StructuredRequest): Promise<T> {
  const stage = stageForTask(request.task);
  let violations: string[] | undefined;

  for (let attempt = 1; attempt <= request.maxAttempts; attempt += 1) {
    const prompt = buildTaskPrompt(request.task, request.input, violations);
    const output = await request.send(prompt, violations);
    const canRetry = attempt < request.maxAttempts;
    try {
      const raw = parseJsonOutput(output, request.label, stage);
      return normalizeTaskPayload(request.task, raw, request.input) as T;
    } catch (error) {
      const repairable = error instanceof TaskContractError ||
        (error instanceof OrchestrationError && error.code === "LIVE_PROVIDER_INVALID_RESPONSE");
      if (repairable && canRetry) {
        violations = error instanceof TaskContractError
          ? [...error.violations]
          : ["上一次响应不是合法 JSON 对象（可能被截断或含多余文字），请只输出一个完整的 JSON 对象"];
        continue;
      }
      if (error instanceof TaskContractError) throw contractError(error, request.label, stage);
      throw error;
    }
  }
  throw new OrchestrationError({
    stage,
    code: "LIVE_PROVIDER_INVALID_RESPONSE",
    message: `${request.label} produced no usable JSON after ${request.maxAttempts} attempts`,
    retryable: false,
  }, 502);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  const record_ = record(value);
  const text = record_.text ?? record_.content;
  return typeof text === "string" ? text : "";
}

/** Resolve an OpenAI-compatible endpoint from a base URL or a full endpoint. */
export function resolveOpenAIEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/v1") return `${trimmed}/chat/completions`;
  return trimmed;
}

export function resolveAnthropicEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/messages$/i.test(trimmed)) return trimmed;
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "") return `${trimmed}/v1/messages`;
  return trimmed;
}

export type HttpJsonModelConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
};

/** Original HerLit JSON task protocol, kept for existing deployments. */
export class HttpJsonModelAdapter implements JsonModelAdapter {
  readonly id: string;
  readonly label: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpJsonModelConfig) {
    this.id = config.provider;
    this.label = `Model adapter ${config.provider}`;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_ATTEMPTS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateJson<T>(task: string, input: unknown): Promise<T> {
    if (!isModelTask(task)) return this.generateRaw<T>(task, input);
    const label = this.label;
    return runStructuredTask<T>({
      label,
      task,
      input,
      maxAttempts: this.maxAttempts,
      send: (prompt, violations) => this.send(task, input, prompt, violations),
    });
  }

  private async send(
    task: string,
    input: unknown,
    prompt: PromptPair,
    violations: readonly string[] | undefined,
  ): Promise<string> {
    const stage = stageForTask(task);
    const response = await providerFetch(this.fetchImpl, this.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        task,
        input,
        responseFormat: "json",
        prompt,
        ...(violations?.length ? { validationViolations: [...violations] } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }, this.label, stage);
    const payload = await readJsonResponse(response, this.label, stage) as { data?: unknown } | unknown;
    const data = record(payload).data;
    if (data === undefined) {
      if (typeof payload === "string") return payload;
      throw invalidResponse(this.label, stage, "returned no data field");
    }
    return typeof data === "string" ? data : JSON.stringify(data);
  }

  /** Unknown tasks stay verbatim so future stages are not silently rewritten. */
  private async generateRaw<T>(task: string, input: unknown): Promise<T> {
    const stage = stageForTask(task);
    const response = await providerFetch(this.fetchImpl, this.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: this.model, task, input, responseFormat: "json" }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }, this.label, stage);
    const payload = await readJsonResponse(response, this.label, stage) as { data?: T } | T;
    return ((payload as { data?: T }).data ?? payload) as T;
  }
}

export type OpenAIChatConfig = HttpJsonModelConfig & {
  jsonMode?: JsonMode;
  maxOutputTokens?: number;
};

/** OpenAI Chat Completions and compatible servers. */
export class OpenAIChatModelAdapter implements JsonModelAdapter {
  readonly id: string;
  readonly label: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly jsonMode: JsonMode;
  private readonly maxOutputTokens?: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAIChatConfig) {
    this.id = config.provider;
    this.label = `OpenAI-compatible adapter ${config.provider}`;
    this.endpoint = resolveOpenAIEndpoint(config.baseUrl);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_ATTEMPTS;
    this.jsonMode = config.jsonMode ?? "auto";
    this.maxOutputTokens = config.maxOutputTokens;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateJson<T>(task: string, input: unknown): Promise<T> {
    if (!isModelTask(task)) throw invalidResponse(this.label, stageForTask(task), `does not implement task ${task}`);
    return runStructuredTask<T>({
      label: this.label,
      task,
      input,
      maxAttempts: this.maxAttempts,
      send: (prompt) => this.sendOnce(task, prompt),
    });
  }

  private async sendOnce(task: ModelTask, prompt: PromptPair): Promise<string> {
    const stage = stageForTask(task);
    let useJsonMode = this.jsonMode !== "off";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const body: Record<string, unknown> = {
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(this.maxOutputTokens ? { max_tokens: this.maxOutputTokens } : {}),
      };
      const response = await providerFetch(this.fetchImpl, this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      }, this.label, stage);

      // Some OpenAI-compatible servers reject response_format. Retry once
      // without it instead of failing a task the endpoint can actually run.
      if (!response.ok && response.status === 400 && useJsonMode) {
        useJsonMode = false;
        continue;
      }
      if (!response.ok) throw statusError(response, this.label, stage);

      const payload = await readJsonResponse(response, this.label, stage);
      const choices = record(payload).choices;
      const choice = record(Array.isArray(choices) ? choices[0] : undefined);
      const message = record(choice.message);
      const content = typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? (message.content as unknown[]).map(textOf).join("")
          : "";
      if (!content.trim()) {
        throw invalidResponse(this.label, stage, textOf(choice.finish_reason) === "length"
          ? "truncated the response before any content"
          : "returned an empty message");
      }
      return content;
    }
    throw new OrchestrationError({
      stage,
      code: "LIVE_PROVIDER_REJECTED",
      message: `${this.label} rejected the request (HTTP 400) with and without response_format`,
      retryable: false,
    }, 502);
  }
}

export type AnthropicMessagesConfig = HttpJsonModelConfig & {
  maxOutputTokens?: number;
};

/** Anthropic Messages API. */
export class AnthropicMessagesModelAdapter implements JsonModelAdapter {
  readonly id: string;
  readonly label: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly maxOutputTokens?: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnthropicMessagesConfig) {
    this.id = config.provider;
    this.label = `Anthropic adapter ${config.provider}`;
    this.endpoint = resolveAnthropicEndpoint(config.baseUrl);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_ATTEMPTS;
    this.maxOutputTokens = config.maxOutputTokens;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateJson<T>(task: string, input: unknown): Promise<T> {
    if (!isModelTask(task)) throw invalidResponse(this.label, stageForTask(task), `does not implement task ${task}`);
    return runStructuredTask<T>({
      label: this.label,
      task,
      input,
      maxAttempts: this.maxAttempts,
      send: async (prompt) => {
        const stage = stageForTask(task);
        const response = await providerFetch(this.fetchImpl, this.endpoint, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: this.maxOutputTokens ?? taskOutputBudget(task),
            temperature: 0.2,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.user }],
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        }, this.label, stage);
        const payload = await readJsonResponse(response, this.label, stage);
        const content = record(payload).content;
        const text = Array.isArray(content)
          ? (content as unknown[]).map((block) => textOf(record(block).text)).join("")
          : "";
        if (!text.trim()) {
          throw invalidResponse(this.label, stage, textOf(record(payload).stop_reason) === "max_tokens"
            ? "truncated the response (max_tokens)"
            : "returned no text content");
        }
        return text;
      },
    });
  }
}

export function createModelAdapter(config: EditorialModelConfig): JsonModelAdapter {
  switch (config.protocol) {
    case "generic_json":
      return new HttpJsonModelAdapter(config);
    case "openai_chat":
      return new OpenAIChatModelAdapter(config);
    case "anthropic_messages":
      return new AnthropicMessagesModelAdapter(config);
    default: {
      const exhaustive: never = config.protocol;
      throw new Error(`Unsupported model protocol ${String(exhaustive)}`);
    }
  }
}
