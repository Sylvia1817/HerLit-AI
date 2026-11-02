/**
 * Backwards-compatible entry point for live adapters.
 *
 * The implementations now live under `live/`:
 * - `live/contracts.ts`      – transport interfaces and payload types
 * - `live/http.ts`           – shared fetch/JSON/error normalization
 * - `live/tasks.ts`          – per-task prompts and JSON contracts
 * - `live/normalize.ts`      – deterministic payload repair and validation
 * - `live/model-adapters.ts` – generic / OpenAI-compatible / Anthropic
 * - `live/search-adapters.ts`– generic / Brave / Tavily / Serper
 */

export * from "./live/contracts.ts";
export * from "./live/http.ts";
export * from "./live/model-adapters.ts";
export * from "./live/normalize.ts";
export * from "./live/search-adapters.ts";
export * from "./live/tasks.ts";
