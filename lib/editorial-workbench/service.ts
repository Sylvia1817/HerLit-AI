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
import { assertEditorialDate } from "./date.ts";
import { OrchestrationError, asOrchestrationError } from "./errors.ts";
import {
  approveEditorialPackage,
  exportEditorialJson,
  exportEditorialMarkdown,
} from "./human-review.ts";
import {
  createLiveProviderFactory,
  createMockProviderFactory,
} from "./providers.ts";
import type { WorkbenchProviderFactory } from "./providers.ts";
import { EditorialSessionStore, SessionExpiredError } from "./store.ts";
import type {
  ApprovalResponse,
  CandidateApiMeta,
  CandidatesResponse,
  DiscoveryTraceEntry,
  ExportRequest,
  ExportResponse,
  ProductionResponse,
  ResearchResponse,
  ReviewResponse,
} from "./types.ts";

function validateRequest(request: EditorialRequest): void {
  assertEditorialDate(request.date);
  if (request.excludeWriterIds && !Array.isArray(request.excludeWriterIds)) {
    throw new OrchestrationError({ stage: "selection", code: "INVALID_REQUEST", message: "excludeWriterIds must be an array", retryable: false });
  }
}

function sessionError(stage: "research" | "production" | "review", error: unknown): never {
  if (error instanceof SessionExpiredError) {
    throw new OrchestrationError({
      stage,
      code: `${error.entity.toUpperCase()}_SESSION_EXPIRED`,
      message: `${error.entity} session expired`,
      retryable: true,
    }, 410);
  }
  throw error;
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
      let stored;
      try { stored = this.store.getSelection(input.selectionId); } catch (error) { sessionError("research", error); }
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
      let storedSelection;
      let storedResearch;
      try {
        storedSelection = this.store.getSelection(input.selectionId);
        storedResearch = this.store.getResearch(input.researchId);
      } catch (error) { sessionError("production", error); }
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
      let stored;
      try { stored = this.store.getPackage(input.packageId); } catch (error) { sessionError("review", error); }
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
      this.store.updatePackage(input.packageId, { ...stored, package: next, approval: undefined });
      return { ok: true, data: structuredClone(next), meta: { packageId: input.packageId, providerMode: this.mode } };
    } catch (error) {
      throw asOrchestrationError("review", error);
    }
  }


  async approve(input: { packageId: string }): Promise<ApprovalResponse> {
    try {
      if (typeof input.packageId !== "string" || !input.packageId) {
        throw new OrchestrationError({ stage: "review", code: "INVALID_APPROVAL_REQUEST", message: "packageId is required", retryable: false }, 422);
      }
      let stored;
      try { stored = this.store.getPackage(input.packageId); } catch (error) { sessionError("review", error); }
      if (!stored) throw new OrchestrationError({ stage: "review", code: "PACKAGE_SESSION_NOT_FOUND", message: "Editorial package session expired or is unknown", retryable: true }, 404);
      const approval = approveEditorialPackage(input.packageId, stored.package);
      this.store.updatePackage(input.packageId, { ...stored, approval });
      return { ok: true, data: structuredClone(approval), meta: { packageId: input.packageId, providerMode: this.mode } };
    } catch (error) {
      throw asOrchestrationError("review", error);
    }
  }

  async export(input: ExportRequest): Promise<ExportResponse> {
    try {
      if (
        typeof input.packageId !== "string" || !input.packageId ||
        (input.format !== "markdown" && input.format !== "json") ||
        !Number.isInteger(input.preferredTitleIndex) || input.preferredTitleIndex < 0 ||
        typeof input.publishReady !== "boolean"
      ) {
        throw new OrchestrationError({ stage: "review", code: "INVALID_EXPORT_REQUEST", message: "Export request is invalid", retryable: false }, 422);
      }
      let stored;
      try { stored = this.store.getPackage(input.packageId); } catch (error) { sessionError("review", error); }
      if (!stored) throw new OrchestrationError({ stage: "review", code: "PACKAGE_SESSION_NOT_FOUND", message: "Editorial package session expired or is unknown", retryable: true }, 404);
      const state = stored.approval ?? { status: "editing" as const };
      const options = { preferredTitleIndex: input.preferredTitleIndex, publishReady: input.publishReady };
      const isMarkdown = input.format === "markdown";
      const content = isMarkdown
        ? exportEditorialMarkdown(input.packageId, stored.package, state, options)
        : exportEditorialJson(input.packageId, stored.package, state, options);
      return {
        ok: true,
        data: {
          content,
          contentType: isMarkdown ? "text/markdown" : "application/json",
          fileName: `herlit-${stored.package.date}-${input.publishReady ? "approved" : "draft"}.${isMarkdown ? "md" : "json"}`,
        },
        meta: { packageId: input.packageId, providerMode: this.mode },
      };
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
