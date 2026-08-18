import type {
  Candidate,
  CandidateSignals,
  DateRelevanceTier,
  EditorialRequest,
  ResearchSource,
  ResearchSourceType,
  SkippedResearchSource,
  VerifiedEditorialContext,
  WriterInput,
} from "../../types/editorial.ts";
import type {
  CandidateProposal,
  EditorialCandidateProvider,
} from "../editorial-selection/contracts.ts";
import type {
  EvidenceLeadFinding,
  ResearchClaimProposal,
  ResearchEvidenceProvider,
  ResearchInvestigation,
} from "../research-verification/contracts.ts";
import type {
  EditorialReviewInput,
  EditorialReviewProposal,
  EditorialReviewProvider,
  EditorialWriterProvider,
  ReaderValueProvider,
  ValueModuleProposal,
  WriterProposal,
} from "../editorial-production/contracts.ts";
import type { DiscoveryTraceEntry } from "./types.ts";
import type {
  EditorialSearchAdapter,
  JsonModelAdapter,
  LiveReviewPayload,
  LiveValuePayload,
  LiveWriterPayload,
} from "./live-adapters.ts";
import type { FetchedSource } from "./safe-fetch.ts";
import { OrchestrationError } from "./errors.ts";

const SOURCE_TYPES = new Set<ResearchSourceType>([
  "official", "institution", "library", "publisher", "reputable_media", "secondary",
]);

function assertSignals(signals: CandidateSignals): void {
  for (const [key, value] of Object.entries(signals)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Live candidate signal ${key} must be between 0 and 100`);
    }
  }
}

export class LiveEditorialCandidateProvider implements EditorialCandidateProvider {
  readonly id: string;
  readonly mode = "live" as const;
  readonly calls: DiscoveryTraceEntry[] = [];
  private readonly model: JsonModelAdapter;

  constructor(model: JsonModelAdapter) {
    this.model = model;
    this.id = `live-candidate:${model.id}`;
  }

  async discover(request: EditorialRequest, tier: DateRelevanceTier): Promise<readonly CandidateProposal[]> {
    const payload = await this.model.generateJson<{ candidates: Array<Omit<CandidateProposal, "provenance"> & { score?: unknown; rank?: unknown }> }>(
      "editorial_candidate_discovery",
      {
        request,
        tier,
        rules: "Return discovery leads only. Do not calculate score, penalty, total, rank, or verified status.",
      },
    );
    if (!Array.isArray(payload.candidates)) throw new Error("Live candidate adapter returned invalid candidates");
    const proposals = payload.candidates.map((candidate) => {
      if (Object.hasOwn(candidate, "score") || Object.hasOwn(candidate, "rank")) {
        throw new Error("Live candidate provider cannot supply score or rank");
      }
      assertSignals(candidate.signals);
      return {
        id: candidate.id,
        writer: structuredClone(candidate.writer),
        proposedWhyHerToday: structuredClone(candidate.proposedWhyHerToday),
        signals: structuredClone(candidate.signals),
        editorialReason: candidate.editorialReason,
        risks: [...candidate.risks],
        provenance: { providerId: this.id, providerMode: this.mode },
      } satisfies CandidateProposal;
    });
    this.calls.push({ tier, discovered: proposals.length });
    return proposals;
  }
}

type ExtractionPayload = {
  sourceMetadata: Array<{
    sourceId: string;
    sourceType: ResearchSourceType;
    title: string;
    publisher?: string;
  }>;
  claims: ResearchClaimProposal[];
  leadFindings: EvidenceLeadFinding[];
};

export class LiveResearchEvidenceProvider implements ResearchEvidenceProvider {
  readonly id: string;
  readonly mode = "live" as const;
  private readonly model: JsonModelAdapter;
  private readonly search: EditorialSearchAdapter;
  private readonly fetchSource: (url: string) => Promise<FetchedSource>;

  constructor(options: {
    model: JsonModelAdapter;
    search: EditorialSearchAdapter;
    fetchSource: (url: string) => Promise<FetchedSource>;
  }) {
    this.model = options.model;
    this.search = options.search;
    this.fetchSource = options.fetchSource;
    this.id = `live-research:${options.search.id}:${options.model.id}`;
  }

  async investigate(candidate: Candidate): Promise<ResearchInvestigation> {
    const queryPayload = await this.model.generateJson<{ queries: string[] }>(
      "editorial_research_queries",
      { writer: candidate.writer, whyHerToday: candidate.proposedWhyHerToday },
    );
    const queries = Array.isArray(queryPayload.queries) ? queryPayload.queries.slice(0, 4) : [];
    if (queries.length === 0) throw new Error("Live research produced no search queries");
    const searchAttempts = await Promise.allSettled(queries.map((query) => this.search.search(query)));
    const searchSkips: SkippedResearchSource[] = searchAttempts.flatMap((attempt, index) =>
      attempt.status === "fulfilled" ? [] : [{
        url: `search:${queries[index]}`,
        code: attempt.reason instanceof OrchestrationError ? attempt.reason.code : "SEARCH_FAILED",
        message: attempt.reason instanceof Error ? attempt.reason.message : "Search failed",
        retryable: attempt.reason instanceof OrchestrationError ? attempt.reason.retryable : true,
      }],
    );
    const results = searchAttempts
      .flatMap((attempt) => attempt.status === "fulfilled" ? [...attempt.value] : [])
      .filter((result, index, all) => all.findIndex(({ url }) => url === result.url) === index)
      .slice(0, 6);
    const fetchAttempts = await Promise.allSettled(results.map(async (result, index) => ({
      id: `live-source-${index + 1}`,
      result,
      page: await this.fetchSource(result.url),
    })));
    const fetched = fetchAttempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
    const fetchSkips: SkippedResearchSource[] = fetchAttempts.flatMap((attempt, index) => {
      if (attempt.status === "fulfilled") return [];
      const reason = attempt.reason;
      return [{
        url: results[index].url,
        title: results[index].title,
        code: reason instanceof OrchestrationError ? reason.code : "SOURCE_FETCH_FAILED",
        message: reason instanceof Error ? reason.message : "Source fetch failed",
        retryable: reason instanceof OrchestrationError ? reason.retryable : true,
      }];
    });
    const skippedSources = [...searchSkips, ...fetchSkips];
    if (fetched.length === 0) {
      throw new OrchestrationError({
        stage: "research",
        code: "NO_USABLE_RESEARCH_SOURCES",
        message: "Live research found no safe, fetchable sources",
        retryable: skippedSources.some(({ retryable }) => retryable),
        details: { skippedSources },
      }, 422);
    }
    const extraction = await this.model.generateJson<ExtractionPayload>(
      "editorial_claim_extraction",
      {
        candidate,
        sources: fetched.map(({ id, result, page }) => ({
          sourceId: id,
          url: page.url,
          searchTitle: result.title,
          contentType: page.contentType,
          content: page.text.slice(0, 60_000),
        })),
        rules: "Extract only claims supported by supplied source IDs. Do not set verified, confidence, or readyForDraft.",
      },
    );
    const metadata = new Map(extraction.sourceMetadata?.map((item) => [item.sourceId, item]) ?? []);
    const sources: ResearchSource[] = fetched.map(({ id, result, page }) => {
      const item = metadata.get(id);
      const sourceType = item && SOURCE_TYPES.has(item.sourceType) ? item.sourceType : "secondary";
      return {
        id,
        url: page.url,
        title: item?.title || result.title,
        publisher: item?.publisher,
        sourceType,
        retrievedAt: new Date().toISOString(),
        providerId: this.id,
        providerMode: this.mode,
      };
    });
    return {
      sources,
      claimProposals: structuredClone(extraction.claims ?? []),
      leadFindings: structuredClone(extraction.leadFindings ?? []),
      skippedSources,
    };
  }
}

export class LiveReaderValueProvider implements ReaderValueProvider {
  readonly id: string;
  readonly mode = "live" as const;
  private readonly model: JsonModelAdapter;
  constructor(model: JsonModelAdapter) { this.model = model; this.id = `live-value:${model.id}`; }
  async propose(context: VerifiedEditorialContext): Promise<readonly ValueModuleProposal[]> {
    const result = await this.model.generateJson<LiveValuePayload>("reader_value_modules", context);
    return structuredClone(result.modules ?? []);
  }
}

export class LiveEditorialWriterProvider implements EditorialWriterProvider {
  readonly id: string;
  readonly mode = "live" as const;
  private readonly model: JsonModelAdapter;
  constructor(model: JsonModelAdapter) { this.model = model; this.id = `live-writer:${model.id}`; }
  async draft(input: WriterInput): Promise<WriterProposal> {
    return structuredClone(await this.model.generateJson<LiveWriterPayload>("grounded_editorial_draft", input));
  }
}

export class LiveEditorialReviewProvider implements EditorialReviewProvider {
  readonly id: string;
  readonly mode = "live" as const;
  private readonly model: JsonModelAdapter;
  constructor(model: JsonModelAdapter) { this.model = model; this.id = `live-review:${model.id}`; }
  async review(input: EditorialReviewInput): Promise<EditorialReviewProposal> {
    return structuredClone(await this.model.generateJson<LiveReviewPayload>("editorial_growth_review", input));
  }
}
