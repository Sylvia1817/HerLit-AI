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

export type WhyHerToday = {
  relationType: RelationType;
  relationDate?: string;
  tier: DateRelevanceTier;
  isEditorialLink: boolean;
  shortReason: string;
  editorExplanation: string;
  evidenceClaimIds: string[];
};

export type CandidateScore = {
  /** All positive dimensions use a 0–100 scale. */
  dateRelevance: number;
  sourceConfidence: number;
  recognition: number;
  storyTension: number;
  readerValue: number;
  growthPotential: number;
  herlitDistinctiveness: number;
  /** A 0–100 deduction applied after the positive dimensions. */
  recentRepeatPenalty: number;
  weightedTotal: number;
};

export type Candidate = {
  id: string;
  writer: WriterSummary;
  whyHerToday: WhyHerToday;
  score: CandidateScore;
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

export type ResearchPack = {
  candidateId: string;
  writer: WriterSummary;
  whyHerToday: WhyHerToday;
  claims: ResearchClaim[];
  verification: {
    passedClaimIds: string[];
    needsReviewClaimIds: string[];
    rejectedClaimIds: string[];
  };
  readyForDraft: boolean;
};

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
  whyHerToday: WhyHerToday;
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
  whyHerToday: WhyHerToday;
  verifiedClaims: VerifiedResearchClaim[];
  valueModules: ValueModuleCollection;
  style?: string | null;
};
