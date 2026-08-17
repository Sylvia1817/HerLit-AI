import type {
  EditorialRequest,
  GroundedDraft,
  ResearchPack,
  ValueModuleCollection,
} from "../../types/editorial.ts";
import { DailyEditorialSelectionEngine } from "../editorial-selection/engine.ts";
import { ResearchVerificationEngine, assertResearchPack } from "../research-verification/engine.ts";
import {
  DailyEditorialProductionEngine,
  EditorialReviewEngine,
  assertDailyEditorialPackage,
  assertGroundedDraft,
  assertValueModules,
  HERLIT_BRAND_RULES,
} from "../editorial-production/index.ts";
import { loadEditorialRuntimeConfig } from "./config.ts";
import { OrchestrationError, asOrchestrationError } from "./errors.ts";
import {
  createLiveProviderFactory,
  createMockProviderFactory,
} from "./providers.ts";
import type { WorkbenchProviderFactory } from "./providers.ts";
import { EditorialSessionStore } from "./store.ts";
import type {
  CandidateApiMeta,
  CandidatesResponse,
  DiscoveryTraceEntry,
  ProductionResponse,
  ResearchResponse,
  ReviewResponse,
} from "./types.ts";

function validateRequest(request: EditorialRequest): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date)) {
    throw new OrchestrationError({ stage: "selection", code: "INVALID_REQUEST", message: "date must use YYYY-MM-DD", retryable: false });
  }
  if (request.excludeWriterIds && !Array.isArray(request.excludeWriterIds)) {
    throw new OrchestrationError({ stage: "selection", code: "INVALID_REQUEST", message: "excludeWriterIds must be an array", retryable: false });
  }
}

export function researchReadinessDetails(pack: ResearchPack): string[] {
  const verified = pack.claims.filter(({ verified }) => verified);
  const missing: string[] = [];
  if (!pack.verifiedWhyHerToday) missing.push("Why Her Today 尚未核验");
  if (!verified.some(({ category }) => category === "bio")) missing.push("缺少 verified bio claim");
  if (!verified.some(({ category }) => category === "work")) missing.push("缺少 verified work claim");
  if (verified.length < 4) missing.push(`仅有 ${verified.length} 条 verified claims，需要至少 4 条`);
  return missing;
}

export class EditorialWorkbenchService {
  readonly mode: WorkbenchProviderFactory["mode"];
  private readonly providers: WorkbenchProviderFactory;
  private readonly store: EditorialSessionStore;

  constructor(options?: { providers?: WorkbenchProviderFactory; store?: EditorialSessionStore }) {
    const config = options?.providers ? undefined : loadEditorialRuntimeConfig();
    this.providers = options?.providers ?? (config!.mode === "live" ? createLiveProviderFactory(config!) : createMockProviderFactory());
    this.mode = this.providers.mode;
    this.store = options?.store ?? new EditorialSessionStore();
  }

  async candidates(request: EditorialRequest): Promise<CandidatesResponse> {
    try {
      validateRequest(request);
      const candidateProvider = this.providers.createCandidateProvider();
      const engine = new DailyEditorialSelectionEngine(candidateProvider, this.providers.createHistoryProvider());
      const selection = await engine.select(structuredClone(request));
      const discoveryTrace: DiscoveryTraceEntry[] = structuredClone(candidateProvider.calls ?? []);
      const selectionId = this.store.saveSelection({
        request,
        selection,
        providerMode: this.mode,
        providerId: candidateProvider.id,
        discoveryTrace,
      });
      const meta: CandidateApiMeta = { selectionId, providerMode: this.mode, providerId: candidateProvider.id, discoveryTrace };
      return { ok: true, data: structuredClone(selection), meta };
    } catch (error) {
      throw asOrchestrationError("selection", error);
    }
  }

  async research(input: { selectionId: string; candidateId: string; selection?: unknown }): Promise<ResearchResponse> {
    try {
      const stored = this.store.getSelection(input.selectionId);
      if (!stored) throw new OrchestrationError({ stage: "research", code: "SELECTION_SESSION_NOT_FOUND", message: "Selection session expired or is unknown", retryable: true }, 404);
      const candidate = stored.selection.candidateShortlist.find(({ id }) => id === input.candidateId);
      if (!candidate) throw new OrchestrationError({ stage: "research", code: "CANDIDATE_NOT_IN_SHORTLIST", message: "Research candidate must belong to the server shortlist", retryable: false }, 422);
      if (candidate.id !== stored.selection.selectedCandidate.id) {
        throw new OrchestrationError({ stage: "research", code: "EDITOR_OVERRIDE_NOT_ENABLED", message: "This MVP currently researches the confirmed Today's Pick only", retryable: false }, 422);
      }
      const provider = this.providers.createResearchProvider();
      const pack = await new ResearchVerificationEngine(provider).research(candidate);
      const researchId = this.store.saveResearch({ selectionId: input.selectionId, pack, providerMode: this.mode });
      return { ok: true, data: structuredClone(pack), meta: { researchId, selectionId: input.selectionId, providerMode: this.mode } };
    } catch (error) {
      throw asOrchestrationError("research", error);
    }
  }

  async produce(input: { selectionId: string; researchId: string; style?: string | null; selection?: unknown; researchPack?: unknown }): Promise<ProductionResponse> {
    try {
      const storedSelection = this.store.getSelection(input.selectionId);
      const storedResearch = this.store.getResearch(input.researchId);
      if (!storedSelection || !storedResearch || storedResearch.selectionId !== input.selectionId) {
        throw new OrchestrationError({ stage: "production", code: "EDITORIAL_SESSION_NOT_FOUND", message: "Selection or Research session expired", retryable: true }, 404);
      }
      assertResearchPack(storedResearch.pack);
      if (!storedResearch.pack.readyForDraft) {
        throw new OrchestrationError({
          stage: "production",
          code: "RESEARCH_NOT_DRAFT_READY",
          message: "ResearchPack is not ready for drafting",
          retryable: false,
          details: { missing: researchReadinessDetails(storedResearch.pack) },
        }, 422);
      }
      const production = this.providers.createProductionProviders();
      const result = await new DailyEditorialProductionEngine(production.value, production.writer, production.review)
        .produce(storedSelection.selection, storedResearch.pack, input.style);
      const packageId = this.store.savePackage({ researchId: input.researchId, package: result, providerMode: this.mode });
      return { ok: true, data: structuredClone(result), meta: { packageId, researchId: input.researchId, providerMode: this.mode } };
    } catch (error) {
      throw asOrchestrationError("production", error);
    }
  }

  async review(input: { packageId: string; valueModules: ValueModuleCollection; draft: GroundedDraft }): Promise<ReviewResponse> {
    try {
      const stored = this.store.getPackage(input.packageId);
      if (!stored) throw new OrchestrationError({ stage: "review", code: "PACKAGE_SESSION_NOT_FOUND", message: "Editorial package session expired", retryable: true }, 404);
      const valueModules = structuredClone(input.valueModules);
      const draft = structuredClone(input.draft);
      assertValueModules(valueModules, stored.package.verifiedContext);
      assertGroundedDraft(draft, { context: stored.package.verifiedContext, valueModules, brandRules: HERLIT_BRAND_RULES });
      const review = await new EditorialReviewEngine(this.providers.createReviewProvider()).create({
        context: stored.package.verifiedContext,
        valueModules,
        draft,
      });
      const next = { ...stored.package, valueModules, draft, review };
      assertDailyEditorialPackage(next);
      this.store.updatePackage(input.packageId, { ...stored, package: next });
      return { ok: true, data: structuredClone(next), meta: { packageId: input.packageId, providerMode: this.mode } };
    } catch (error) {
      throw asOrchestrationError("review", error);
    }
  }
}

let singleton: EditorialWorkbenchService | undefined;
export function getEditorialWorkbenchService(): EditorialWorkbenchService {
  singleton ??= new EditorialWorkbenchService();
  return singleton;
}
