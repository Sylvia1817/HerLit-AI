# Live providers: services, configuration and behaviour

This document describes how `EDITORIAL_PROVIDER_MODE=live` actually reaches a
model and a search service, what each configuration value means, and which
parts of the pipeline remain program-owned.

## 1. What the existing live adapters assumed

Before this change, live mode only spoke one protocol:

```text
POST {EDITORIAL_MODEL_BASE_URL}
authorization: Bearer <key>
{ "model": "...", "task": "editorial_candidate_discovery", "input": {...}, "responseFormat": "json" }
→ { "data": <task payload> }
```

That is a **HerLit JSON-task protocol**: a thin server that owns the prompt,
the model choice and the JSON mode. It is not an OpenAI or Anthropic API. Filling
`EDITORIAL_MODEL_BASE_URL` with `https://api.openai.com/v1` and a bearer key
would therefore fail — OpenAI expects `messages`, not `task`/`input`.

The same was true for search: `POST {query, limit}` with `{results:[…]}` is a
normalized search protocol, not the Brave, Tavily or Serper request shape.

Live mode also had three practical gaps for real content production:

- fetched HTML was passed to the model as raw markup;
- six sources × 60k characters frequently exceeded a real model's context;
- a real model rarely satisfies the editorial JSON contract on the first try
  (card order, required hashtags, a missing Why Her Today card, invented source
  ids), and every violation surfaced as an opaque `STAGE_FAILED`.

## 2. Services you need

| Purpose | Service | Required |
| --- | --- | --- |
| Content generation | any OpenAI-compatible chat service **or** Anthropic Messages | yes (live) |
| Source discovery | Brave Search, Tavily, Serper, or your own normalized search service | yes (live) |
| Source retrieval | outbound HTTPS from the server to public sites (SSRF-guarded) | yes (live) |
| Publishing | none — HerLit never publishes automatically | — |

Everything else (scoring, verification policy, quote attribution, review
binding, approval, export) is local program logic and needs no external service.

## 3. Protocol matrix

| Protocol | Adapter | Endpoint | Auth |
| --- | --- | --- | --- |
| `generic_json` | `HttpJsonModelAdapter` | your HerLit task server (`{model, task, input}` → `{data}`) | `Authorization: Bearer` |
| `openai_chat` | `OpenAIChatModelAdapter` | `{base}/chat/completions` (base URLs ending in `/v1` get this path appended; a full endpoint is used as-is) | `Authorization: Bearer` |
| `anthropic_messages` | `AnthropicMessagesModelAdapter` | `{base}/v1/messages` | `x-api-key` + `anthropic-version` |
| `brave` | `BraveSearchAdapter` | `https://api.search.brave.com/res/v1/web/search` | `X-Subscription-Token` |
| `tavily` | `TavilySearchAdapter` | `https://api.tavily.com/search` | `Authorization: Bearer` |
| `serper` | `SerperSearchAdapter` | `https://google.serper.dev/search` | `X-API-KEY` |

`EDITORIAL_MODEL_PROTOCOL` / `EDITORIAL_SEARCH_PROTOCOL` default to
`generic_json`. Setting a vendor base URL while the protocol is still
`generic_json` is rejected with `LIVE_PROVIDER_CONFIG_MISMATCH`, so the mistake
fails loudly instead of producing confusing parse errors.

## 4. Example configurations

OpenAI (or any compatible gateway — DeepSeek, Moonshot, Qwen, Zhipu, OpenRouter,
vLLM, Ollama):

```dotenv
EDITORIAL_PROVIDER_MODE=live
EDITORIAL_MODEL_PROTOCOL=openai_chat
EDITORIAL_MODEL_PROVIDER=openai
EDITORIAL_MODEL_BASE_URL=https://api.openai.com/v1
EDITORIAL_MODEL_API_KEY=sk-...
EDITORIAL_MODEL_NAME=gpt-4.1-mini
EDITORIAL_MODEL_JSON_MODE=auto

EDITORIAL_SEARCH_PROTOCOL=brave
EDITORIAL_SEARCH_PROVIDER=brave
EDITORIAL_SEARCH_API_KEY=...
```

Anthropic + Tavily:

```dotenv
EDITORIAL_MODEL_PROTOCOL=anthropic_messages
EDITORIAL_MODEL_PROVIDER=anthropic
EDITORIAL_MODEL_BASE_URL=https://api.anthropic.com
EDITORIAL_MODEL_API_KEY=sk-ant-...
EDITORIAL_MODEL_NAME=claude-sonnet-4-5
EDITORIAL_MODEL_MAX_OUTPUT_TOKENS=8000

EDITORIAL_SEARCH_PROTOCOL=tavily
EDITORIAL_SEARCH_PROVIDER=tavily
EDITORIAL_SEARCH_API_KEY=tvly-...
```

Existing custom JSON-task server (unchanged):

```dotenv
EDITORIAL_MODEL_PROTOCOL=generic_json
EDITORIAL_MODEL_PROVIDER=herlit-proxy
EDITORIAL_MODEL_BASE_URL=https://proxy.internal/herlit/tasks
EDITORIAL_MODEL_API_KEY=...
EDITORIAL_MODEL_NAME=herlit-editorial-v1

EDITORIAL_SEARCH_PROTOCOL=generic_json
EDITORIAL_SEARCH_PROVIDER=herlit-search
EDITORIAL_SEARCH_BASE_URL=https://proxy.internal/herlit/search
EDITORIAL_SEARCH_API_KEY=...
```

`EDITORIAL_MODEL_JSON_MODE` controls `response_format: {type: "json_object"}`:
`auto` (default) sends it and retries once without it if the server returns
HTTP 400, `on` always sends it, `off` never sends it.

## 5. How a task is executed

```text
domain engine
  → task prompt (lib/editorial-workbench/live/tasks.ts)
  → protocol request (live/model-adapters.ts)
  → JSON extraction from fenced/prose output (live/http.ts)
  → deterministic normalization (live/normalize.ts)
  → one repair attempt listing the violated constraints
  → domain validation (unchanged engines)
```

Normalization never fabricates editorial content. It only repairs program-owned
scaffolding and drops untrustworthy input:

| Repaired silently | Rejected (repair attempt, then stage error) |
| --- | --- |
| required hashtags added, card order renumbered, `status` forced to `draft`, model-provided `body` discarded | fewer than 3 titles, a fact block without a verified claim |
| Tier C forced to `isEditorialLink: true`, Tier A/B to `false` | a fact draft without a `why_today` block |
| duplicate claim/lead ids deduplicated | missing Why Her Today card |
| evidence citing a source id that was never fetched is dropped | quotes whose canonical wording or attribution label is missing |
| unknown `sourceType` falls back to `secondary` | `growthNotes` entries that are empty or too short |
| an Evidence Lead without a finding is recorded as `needs_review` | fewer than 3 usable Value Modules/claims |
| `recommendation` forced to `needs_revision` when an error issue exists | |

Retrieval budget per research run: up to 6 search results, at most 2 per host,
5 fetched sources, 12k characters per source, 48k characters total. Fetched
HTML is reduced to readable text and decoded with the declared charset.

## 6. Running it

```bash
# whole pipeline without a browser
npm run smoke:live -- --date 2026-11-02

# interactive workbench
EDITORIAL_PROVIDER_MODE=live npm run dev
curl -s localhost:3000/api/editorial/health | jq
```

`/api/editorial/health` returns the mode, protocol, model name, endpoint host
and missing variable names. It never returns a key, a query string or an
upstream body. The workbench header shows the same summary in live mode.

The smoke script writes `runtime/live-smoke-<date>.json` (git-ignored). It exits
non-zero when research is not draft-ready, because "no verified claims" is a
content outcome, not a success.

## 7. Diagnosing failures

Every failure keeps its editorial stage (`selection`, `research`, `production`,
`review`) and a stable code:

| Code | Meaning | What to do |
| --- | --- | --- |
| `LIVE_PROVIDER_UNAVAILABLE` | missing configuration, network failure, 429/5xx | check env vars and provider status |
| `LIVE_PROVIDER_CONFIG_INVALID` | bad protocol, non-integer timeout/attempts | fix the named variable |
| `LIVE_PROVIDER_CONFIG_MISMATCH` | vendor URL under `generic_json` | set the matching protocol |
| `LIVE_PROVIDER_UNAUTHORIZED` | 401/403 from the provider | rotate/repair the key |
| `LIVE_PROVIDER_ENDPOINT_NOT_FOUND` | 404 | base URL is wrong |
| `LIVE_PROVIDER_REJECTED` | other 4xx | usually a model name or payload issue |
| `LIVE_PROVIDER_TIMEOUT` | request timed out | raise `*_TIMEOUT_MS` or shorten the task |
| `LIVE_PROVIDER_INVALID_RESPONSE` | no JSON / truncated output | lower source budget, raise max tokens |
| `LIVE_CONTENT_CONTRACT_VIOLATION` | the model still violated the editorial contract after one repair | inspect `details.violations`, tighten the model or switch models |
| `NO_USABLE_RESEARCH_SOURCES` | nothing survived search + safe fetch | see `details.skippedSources` |
| `SOURCE_URL_BLOCKED` | SSRF guard rejected a URL | expected for private/localhost targets |

Provider response bodies are never echoed: they may contain account data. Use
the provider dashboard, the `requestId` in `details`, and the stage-specific
`details` for support.

## 8. Secrets

- Keys live only in local environment variables (`.env`, git-ignored) or the
  hosting provider's secret store.
- `.env.example` documents names, never values.
- CI runs Gitleaks over the full Git history; a finding anywhere in history
  fails the check. Rotate a leaked key instead of allowlisting it.
- Exports (`Markdown`/`JSON`) include the research audit. Treat them as internal
  material and never place credentials or private notes in the workbench.

## 9. Known boundaries

- **Source classification is model-assigned.** `sourceType` decides whether a
  claim can pass verification. A model can over-claim `official`, so the
  Research audit must still be read by an editor. A valid claim id does not prove
  that prose is entailed by its source.
- **Selection still relies on model knowledge** to propose candidates; Research
  verifies the date link and facts, but a persona that does not exist will simply
  fail research. There is no writer database yet.
- **Extraction is lossy by design.** Claims are dropped when they cite sources
  that were not fetched; the pack shows `needs_review`/`rejected` instead of
  filling gaps.
- **One repair attempt.** `EDITORIAL_MODEL_ATTEMPTS=2` is the default; raising it
  costs more tokens without guaranteeing a better editorial result.
- **Chat models, not reasoning-only models.** The OpenAI adapter sends
  `temperature` and, when configured, `max_tokens`; reasoning models that reject
  those parameters will answer with HTTP 400.
- **No publishing.** Approval remains a human action, the domain status stays
  `draft`, and nothing is posted to Xiaohongshu.
- **Session memory only.** Editorial sessions are in-process with a TTL; there is
  still no content history database, so `recentRepeatPenalty` cannot use real
  published history in live mode yet.

## 10. What CI verifies

`npm test` covers protocol request shapes, endpoint resolution, JSON extraction
from fenced output, repair behaviour, normalization invariants, HTML/charset
extraction, config validation, diagnostics redaction, and a full
candidates → research → draft → review run through the real adapters with a fake
transport. It does not call a paid provider. A real end-to-end run requires your
own keys and is what `npm run smoke:live` is for.
