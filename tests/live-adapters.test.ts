import assert from "node:assert/strict";
import test from "node:test";

import { loadEditorialRuntimeConfig } from "../lib/editorial-workbench/config.ts";
import { describeEditorialRuntime } from "../lib/editorial-workbench/diagnostics.ts";
import { OrchestrationError } from "../lib/editorial-workbench/errors.ts";
import {
  AnthropicMessagesModelAdapter,
  OpenAIChatModelAdapter,
  resolveAnthropicEndpoint,
  resolveOpenAIEndpoint,
} from "../lib/editorial-workbench/live/model-adapters.ts";
import {
  BraveSearchAdapter,
  HttpJsonSearchAdapter,
  SerperSearchAdapter,
  TavilySearchAdapter,
} from "../lib/editorial-workbench/live/search-adapters.ts";

const CANDIDATE_PAYLOAD = {
  candidates: [
    {
      id: "candidate-woolf",
      writer: { id: "writer-woolf", name: "弗吉尼亚·伍尔夫", originalName: "Virginia Woolf", knownFor: ["《达洛维夫人》（1925）"] },
      proposedWhyHerToday: {
        relationType: "birth",
        relationDate: "1882-01-25",
        tier: "A",
        isEditorialLink: false,
        shortReason: "她出生在这一天",
        editorExplanation: "同月同日的出生关联，等待档案核验",
        evidenceLeads: [{ id: "lead-1", description: "核验出生日期", expectedSourceType: "institution" }],
      },
      signals: {
        dateRelevance: 120,
        sourceAvailability: 88,
        recognition: 90,
        storyTension: 84,
        readerValue: 86,
        growthPotential: 80,
        herlitDistinctiveness: 92,
      },
      editorialReason: "日期入口清晰，作品与读者价值兼具",
      risks: ["需核验首版年份"],
      score: { weightedTotal: 99 },
      rank: 1,
    },
  ],
};

function openAiResponse(content: string): Response {
  return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });
}

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void): Promise<void> {
  const saved = { ...process.env };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    await run();
  } finally {
    process.env = saved;
  }
}

test("endpoint resolution accepts both base URLs and full vendor endpoints", () => {
  assert.equal(resolveOpenAIEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(resolveOpenAIEndpoint("https://api.deepseek.com/v1/chat/completions"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(resolveOpenAIEndpoint("https://gateway.example/openai/deployments/herlit"), "https://gateway.example/openai/deployments/herlit");
  assert.equal(resolveAnthropicEndpoint("https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
  assert.equal(resolveAnthropicEndpoint("https://api.anthropic.com/v1/messages"), "https://api.anthropic.com/v1/messages");
});

test("OpenAI-compatible adapter sends chat messages and normalizes program-owned fields", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string }> = [];
  const adapter = new OpenAIChatModelAdapter({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
    model: "gpt-4.1-mini",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        authorization: String((init?.headers as Record<string, string>).authorization),
      });
      return openAiResponse("```json\n" + JSON.stringify(CANDIDATE_PAYLOAD) + "\n```");
    },
  });

  const result = await adapter.generateJson<{ candidates: Array<Record<string, unknown>> }>(
    "editorial_candidate_discovery",
    { request: { date: "2026-01-25" }, tier: "A" },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(requests[0].authorization, "Bearer sk-test-key");
  const body = requests[0].body as { messages: Array<{ role: string; content: string }>; response_format: { type: string } };
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /candidates/);
  assert.equal(body.messages[1].role, "user");
  assert.match(body.messages[1].content, /2026-01-25/);

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0] as { signals: { dateRelevance: number }; score?: unknown; rank?: unknown };
  assert.equal(candidate.signals.dateRelevance, 100, "out-of-range model signals are clamped, never trusted");
  assert.equal(candidate.score, undefined);
  assert.equal(candidate.rank, undefined);
});

test("OpenAI-compatible adapter drops response_format once when a server rejects it", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const adapter = new OpenAIChatModelAdapter({
    provider: "compatible",
    baseUrl: "https://llm.example/v1",
    apiKey: "key",
    model: "local-model",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) return new Response("response_format is not supported", { status: 400 });
      return openAiResponse(JSON.stringify(CANDIDATE_PAYLOAD));
    },
  });

  const result = await adapter.generateJson<{ candidates: unknown[] }>(
    "editorial_candidate_discovery",
    { request: { date: "2026-01-25" }, tier: "A" },
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(bodies.length, 2);
  assert.ok("response_format" in bodies[0]);
  assert.equal("response_format" in bodies[1], false);
});

test("credential rejection is reported as an explicit stage error without echoing secrets", async () => {
  const secret = "sk-herlit-should-never-appear";
  const adapter = new OpenAIChatModelAdapter({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: secret,
    model: "gpt-4.1-mini",
    fetchImpl: async () => new Response("invalid api key", { status: 401 }),
  });
  await assert.rejects(
    () => adapter.generateJson("editorial_candidate_discovery", { request: { date: "2026-01-25" }, tier: "A" }),
    (error: unknown) => {
      assert.ok(error instanceof OrchestrationError);
      assert.equal(error.code, "LIVE_PROVIDER_UNAUTHORIZED");
      assert.equal(error.stage, "selection");
      assert.equal(error.retryable, false);
      assert.ok(!JSON.stringify(error.toJSON()).includes(secret));
      return true;
    },
  );
});

test("Anthropic adapter uses Messages API headers and concatenates text blocks", async () => {
  const requests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const adapter = new AnthropicMessagesModelAdapter({
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-key",
    model: "claude-sonnet-4-5",
    fetchImpl: async (_input, init) => {
      requests.push({
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json({
        content: [
          { type: "text", text: '{"queries":["Virginia Woolf archive",' },
          { type: "text", text: '"Woolf 1925 Mrs Dalloway first edition"]}' },
        ],
        stop_reason: "end_turn",
      });
    },
  });

  const result = await adapter.generateJson<{ queries: string[] }>(
    "editorial_research_queries",
    { writer: { name: "弗吉尼亚·伍尔夫", originalName: "Virginia Woolf" }, whyHerToday: { relationType: "birth" } },
  );
  assert.deepEqual(result.queries, ["Virginia Woolf archive", "Woolf 1925 Mrs Dalloway first edition"]);

  const headers = requests[0].headers;
  assert.equal(headers["x-api-key"], "sk-ant-key");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers.authorization, undefined);
  const body = requests[0].body as { system: string; messages: Array<{ role: string; content: string }>; max_tokens: number };
  assert.match(body.system, /queries/);
  assert.equal(body.messages[0].role, "user");
  assert.ok(body.max_tokens > 0);
});

test("search adapters map vendor shapes into traceable URLs and drop junk", async () => {
  const braveRequests: string[] = [];
  const brave = new BraveSearchAdapter({
    provider: "brave",
    baseUrl: "",
    apiKey: "brave-key",
    fetchImpl: async (input) => {
      braveRequests.push(String(input));
      return Response.json({
        web: {
          results: [
            { url: "https://www.bl.uk/people/virginia-woolf", title: "Virginia Woolf", description: "British Library archive" },
            { url: "javascript:alert(1)", title: "junk" },
            { url: "https://www.bl.uk/people/virginia-woolf", title: "duplicate" },
          ],
        },
      });
    },
  });
  const braveResults = await brave.search("Virginia Woolf archive");
  assert.equal(braveResults.length, 1);
  assert.equal(braveResults[0].url, "https://www.bl.uk/people/virginia-woolf");
  assert.equal(braveResults[0].snippet, "British Library archive");
  assert.match(braveRequests[0], /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/);
  assert.match(braveRequests[0], /q=Virginia\+Woolf\+archive/);

  const serper = new SerperSearchAdapter({
    provider: "serper",
    baseUrl: "",
    apiKey: "serper-key",
    fetchImpl: async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "serper-key");
      return Response.json({ organic: [{ link: "https://www.nypl.org/woolf", title: "NYPL", snippet: "archive" }] });
    },
  });
  const serperResults = await serper.search("woolf");
  assert.deepEqual(serperResults.map(({ url }) => url), ["https://www.nypl.org/woolf"]);

  const tavily = new TavilySearchAdapter({
    provider: "tavily",
    baseUrl: "",
    apiKey: "tavily-key",
    fetchImpl: async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer tavily-key");
      return Response.json({ results: [{ url: "https://archive.example/woolf", title: "Archive", content: "excerpt" }] });
    },
  });
  const tavilyResults = await tavily.search("woolf");
  assert.equal(tavilyResults[0].snippet, "excerpt");
});

test("generic search adapter still rejects malformed responses", async () => {
  const adapter = new HttpJsonSearchAdapter({
    provider: "generic",
    baseUrl: "https://search.example/tasks",
    apiKey: "key",
    fetchImpl: async () => Response.json({ items: [] }),
  });
  await assert.rejects(
    () => adapter.search("woolf"),
    (error: unknown) => error instanceof OrchestrationError && error.code === "LIVE_PROVIDER_UNAVAILABLE",
  );
});

test("live configuration defaults to the generic protocol and rejects vendor URLs under it", async () => {
  await withEnv({
    EDITORIAL_PROVIDER_MODE: "live",
    EDITORIAL_MODEL_PROVIDER: "herlit-proxy",
    EDITORIAL_MODEL_BASE_URL: "https://proxy.example/tasks",
    EDITORIAL_MODEL_API_KEY: "model-key",
    EDITORIAL_MODEL_NAME: "herlit-generic",
    EDITORIAL_SEARCH_PROVIDER: "herlit-search",
    EDITORIAL_SEARCH_BASE_URL: "https://proxy.example/search",
    EDITORIAL_SEARCH_API_KEY: "search-key",
  }, () => {
    const config = loadEditorialRuntimeConfig();
    assert.equal(config.model?.protocol, "generic_json");
    assert.equal(config.model?.timeoutMs, 120_000);
    assert.equal(config.model?.maxAttempts, 2);
    assert.equal(config.search?.protocol, "generic_json");
  });

  await withEnv({
    EDITORIAL_PROVIDER_MODE: "live",
    EDITORIAL_MODEL_PROVIDER: "openai",
    EDITORIAL_MODEL_BASE_URL: "https://api.openai.com/v1/chat/completions",
    EDITORIAL_MODEL_API_KEY: "model-key",
    EDITORIAL_MODEL_NAME: "gpt-4.1-mini",
    EDITORIAL_SEARCH_PROVIDER: "tavily",
    EDITORIAL_SEARCH_API_KEY: "search-key",
  }, () => {
    assert.throws(
      () => loadEditorialRuntimeConfig(),
      (error: unknown) => error instanceof OrchestrationError && error.code === "LIVE_PROVIDER_CONFIG_MISMATCH",
    );
  });

  await withEnv({
    EDITORIAL_PROVIDER_MODE: "live",
    EDITORIAL_MODEL_PROTOCOL: "openai_chat",
    EDITORIAL_MODEL_PROVIDER: "openai",
    EDITORIAL_MODEL_BASE_URL: "https://api.openai.com/v1",
    EDITORIAL_MODEL_API_KEY: "model-key",
    EDITORIAL_MODEL_NAME: "gpt-4.1-mini",
    EDITORIAL_SEARCH_PROTOCOL: "tavily",
    EDITORIAL_SEARCH_PROVIDER: "tavily",
    EDITORIAL_SEARCH_BASE_URL: undefined,
    EDITORIAL_SEARCH_API_KEY: "search-key",
  }, () => {
    const config = loadEditorialRuntimeConfig();
    assert.equal(config.model?.protocol, "openai_chat");
    assert.equal(config.search?.protocol, "tavily");
    assert.equal(config.search?.baseUrl, "", "vendors with fixed endpoints do not need a base URL");
  });
});

test("unexpected protocol values fail loudly instead of silently falling back", async () => {
  await withEnv({
    EDITORIAL_PROVIDER_MODE: "live",
    EDITORIAL_MODEL_PROTOCOL: "openai_responses",
    EDITORIAL_MODEL_PROVIDER: "openai",
    EDITORIAL_MODEL_BASE_URL: "https://api.openai.com/v1",
    EDITORIAL_MODEL_API_KEY: "model-key",
    EDITORIAL_MODEL_NAME: "gpt-4.1-mini",
    EDITORIAL_SEARCH_PROTOCOL: "tavily",
    EDITORIAL_SEARCH_PROVIDER: "tavily",
    EDITORIAL_SEARCH_API_KEY: "search-key",
  }, () => {
    assert.throws(
      () => loadEditorialRuntimeConfig(),
      (error: unknown) => error instanceof OrchestrationError &&
        error.code === "LIVE_PROVIDER_CONFIG_INVALID" &&
        error.message.includes("openai_chat"),
    );
  });
});

test("runtime diagnostics list missing settings without exposing secrets", async () => {
  const mock = describeEditorialRuntime({} as NodeJS.ProcessEnv);
  assert.equal(mock.mode, "mock");
  assert.equal(mock.ready, true);

  const live = describeEditorialRuntime({
    EDITORIAL_PROVIDER_MODE: "live",
    EDITORIAL_MODEL_PROVIDER: "openai",
    EDITORIAL_SEARCH_PROVIDER: "tavily",
    EDITORIAL_MODEL_API_KEY: "sk-should-not-leak",
  } as NodeJS.ProcessEnv);
  assert.equal(live.mode, "live");
  assert.equal(live.ready, false);
  assert.ok(live.missing.includes("EDITORIAL_MODEL_BASE_URL"));
  assert.ok(live.missing.includes("EDITORIAL_SEARCH_API_KEY"));
  assert.equal(live.issues[0].code, "LIVE_PROVIDER_UNAVAILABLE");
  assert.ok(!JSON.stringify(live).includes("sk-should-not-leak"));
});
