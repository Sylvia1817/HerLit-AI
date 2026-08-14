/**
 * Phase 2 editorial domain contracts.
 *
 * These types describe the intended data boundaries. They do not imply that
 * the candidate, research or draft APIs are implemented yet.
 */

export const EDITORIAL_LIMITS = {
  candidates: { min: 3, max: 5 },
  titles: { min: 3, max: 5 },
  valueModules: { min: 2, max: 3 },
  cards: { min: 3, max: 6 },
} as const;

export type EditorialRequest = {
  date: string;
  topic?: string | null;
  candidateWriter?: string | null;
  style?: string | null;
  excludeWriters?: string[];
};

export type WriterSummary = {
  id: string;
  name: string;
  originalName?: string;
  birthDate?: string;
  deathDate?: string;
  knownFor: string[];
};

export type RelationType =
  | "birth"
  | "death"
  | "publication"
  | "award"
  | "life_event"
  | "month_link"
  | "seasonal_editorial_link";

export type DateRelevanceTier = "A" | "B" | "C";

export type EvidenceLead = {
  /** Selection-local identifier. It is not a ResearchClaim.id. */
  id: string;
  description: string;
  expectedSourceType?: ResearchSourceType;
  searchHint?: string;
};

export type ProposedWhyHerToday = {
  relationType: RelationType;
  relationDate?: string;
  tier: DateRelevanceTier;
  isEditorialLink: boolean;
  shortReason: string;
  editorExplanation: string;
  /** Unverified leads for Research to investigate. */
  evidenceLeads: EvidenceLead[];
};

export type VerifiedWhyHerToday = {
  relationType: RelationType;
  relationDate?: string;
  tier: DateRelevanceTier;
  isEditorialLink: boolean;
  shortReason: string;
  editorExplanation: string;
  evidenceClaimIds: string[];
};

export type CandidateSignals = {
  /** All preliminary Selection signals use a 0–100 scale. */
  dateRelevance: number;
  /** Preliminary availability of high-quality sources, not claim confidence. */
  sourceAvailability: number;
  recognition: number;
  storyTension: number;
  readerValue: number;
  growthPotential: number;
  herlitDistinctiveness: number;
};

export type CandidateScore = {
  /** Deterministic weighted sum of CandidateSignals before deductions. */
  weightedBase: number;
  /**
   * A 0–100 program-owned deduction derived from recent editorial history.
   * Providers and models must not invent this value.
   */
  recentRepeatPenalty: number;
  /**
   * Deterministically calculated by application code from the dimensions and
   * recentRepeatPenalty. Models must not supply or estimate this value. Step 2
   * will define the exact weights and formula.
   */
  weightedTotal: number;
};

export type CandidateProvenance = {
  providerId: string;
  providerMode: "mock" | "live";
};

export type Candidate = {
  id: string;
  writer: WriterSummary;
  proposedWhyHerToday: ProposedWhyHerToday;
  signals: CandidateSignals;
  score: CandidateScore;
  provenance: CandidateProvenance;
  rank: number;
  editorialReason: string;
  risks: string[];
};

export type CandidateShortlist =
  | [Candidate, Candidate, Candidate]
  | [Candidate, Candidate, Candidate, Candidate]
  | [Candidate, Candidate, Candidate, Candidate, Candidate];

export type SelectionDecision = {
  selectedCandidateId: string;
  whySelected: string;
  whyNotOthers: Array<{
    candidateId: string;
    reason: string;
  }>;
};

export type EditorialSelectionResult = {
  date: string;
  candidateShortlist: CandidateShortlist;
  selectionDecision: SelectionDecision;
  /**
   * Must be the shortlist member whose id equals
   * selectionDecision.selectedCandidateId. Step 2 will enforce this invariant
   * when it assembles the result.
   */
  selectedCandidate: Candidate;
};

export type ResearchClaimCategory =
  | "bio"
  | "date_event"
  | "work"
  | "award"
  | "quote"
  | "relationship"
  | "context";

export type ResearchSourceType =
  | "official"
  | "institution"
  | "library"
  | "publisher"
  | "reputable_media"
  | "secondary";

export type ResearchClaim = {
  id: string;
  claim: string;
  category: ResearchClaimCategory;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublisher?: string;
  sourceType: ResearchSourceType;
  accessedAt: string;
  confidence: "high" | "medium" | "low";
  verified: boolean;
};

export type VerifiedResearchClaim = Omit<ResearchClaim, "verified"> & {
  verified: true;
};

export type EvidenceLeadResolution = {
  evidenceLeadId: string;
  status: "verified" | "needs_review" | "rejected";
  /** ResearchClaim ids created during Research; never Selection lead ids. */
  researchClaimIds: string[];
  note?: string;
};

type ResearchPackBase = {
  candidateId: string;
  writer: WriterSummary;
  proposedWhyHerToday: ProposedWhyHerToday;
  evidenceLeadResolutions: EvidenceLeadResolution[];
  claims: ResearchClaim[];
  verification: {
    passedClaimIds: string[];
    needsReviewClaimIds: string[];
    rejectedClaimIds: string[];
  };
};

export type ResearchPack = ResearchPackBase &
  (
    | {
        readyForDraft: false;
        /** May exist when the date link passed but other required claims did not. */
        verifiedWhyHerToday?: VerifiedWhyHerToday;
      }
    | {
        readyForDraft: true;
        /** Required before any DraftRequest can be assembled. */
        verifiedWhyHerToday: VerifiedWhyHerToday;
      }
  );

export type ValueModuleType =
  | "where_to_start"
  | "reading_path"
  | "verified_quote"
  | "little_known_fact"
  | "women_connection"
  | "literary_history"
  | "work_context"
  | "today_connection";

export type ValueModule = {
  type: ValueModuleType;
  title: string;
  content: string;
  readerBenefit: string;
  evidenceClaimIds: string[];
};

export type ValueModuleCollection =
  | [ValueModule, ValueModule]
  | [ValueModule, ValueModule, ValueModule];

export type CardPlan = {
  order: number;
  role:
    | "cover"
    | "why_her_today"
    | "story"
    | "work"
    | "saveable_knowledge"
    | "reading_path"
    | "interaction";
  title: string;
  copy: string;
  visualDirection: string;
  evidenceClaimIds: string[];
};

export type CardPlanCollection =
  | [CardPlan, CardPlan, CardPlan]
  | [CardPlan, CardPlan, CardPlan, CardPlan]
  | [CardPlan, CardPlan, CardPlan, CardPlan, CardPlan]
  | [CardPlan, CardPlan, CardPlan, CardPlan, CardPlan, CardPlan];

export type TitleCollection =
  | [string, string, string]
  | [string, string, string, string]
  | [string, string, string, string, string];

export type GrowthNotes = {
  clickReason: string;
  readThroughReason: string;
  saveReason: string;
  commentReason: string;
  followReason: string;
};

export type DailyEditorialPackage = {
  date: string;
  candidateShortlist: CandidateShortlist;
  selectedWriter: WriterSummary;
  selectionDecision: SelectionDecision;
  whyHerToday: VerifiedWhyHerToday;
  editorialAngle: string;
  readerHook: string;
  researchClaims: ResearchClaim[];
  titles: TitleCollection;
  body: string;
  hashtags: string[];
  valueModules: ValueModuleCollection;
  cards: CardPlanCollection;
  growthNotes: GrowthNotes;
  verification: {
    passed: string[];
    needsReview: string[];
  };
  status: "draft" | "approved";
};

export type DraftRequest = {
  date: string;
  candidateShortlist: CandidateShortlist;
  selectedWriter: WriterSummary;
  selectionDecision: SelectionDecision;
  whyHerToday: VerifiedWhyHerToday;
  verifiedClaims: VerifiedResearchClaim[];
  valueModules: ValueModuleCollection;
  style?: string | null;
};
