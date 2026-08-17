/**
 * Phase 2 editorial domain contracts.
 *
 * These types describe the intended data boundaries. They do not imply that
 * external APIs or live providers are implemented.
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
  /** Writer IDs that the Selection Engine must exclude after provider discovery. */
  excludeWriterIds?: string[];
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
   * recentRepeatPenalty using the centralized Step 2 formula. Models must not
   * supply or estimate this value.
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

export type ResearchProviderMode = "mock" | "live";

export type ResearchSource = {
  id: string;
  url: string;
  title: string;
  publisher?: string;
  sourceType: ResearchSourceType;
  retrievedAt: string;
  providerId: string;
  providerMode: ResearchProviderMode;
};

export type ClaimEvidence = {
  sourceId: string;
  support: "direct" | "indirect" | "contradicts";
  locator?: string;
  /** Quote verification requires an authoritative excerpt containing its canonical wording. */
  excerpt?: string;
  /** Raw speaker context found at this source location for quote claims. */
  quoteSpeakerContext?: QuoteSourceContext;
};

export type QuoteSpeakerType =
  | "author"
  | "narrator"
  | "character"
  | "other"
  | "unknown";

export type QuoteDocumentType =
  | "work"
  | "letter"
  | "diary"
  | "speech"
  | "interview";

export type QuoteSourceContext = {
  /** Speaker identified by the cited source at the evidence locator. */
  speakerType: QuoteSpeakerType;
  speakerName?: string;
  documentType?: QuoteDocumentType;
  workOrDocument?: string;
  locator?: string;
};

export type QuoteContext = {
  /** Attribution asserted by the claim; policy compares it with source context. */
  attributedSpeakerType: Exclude<QuoteSpeakerType, "unknown">;
  attributedSpeakerName?: string;
};

export type ResearchVerificationStatus =
  | "verified"
  | "needs_review"
  | "rejected";

export type ResearchClaim = {
  id: string;
  claim: string;
  category: ResearchClaimCategory;
  /** A claim may be supported, qualified or contradicted by many sources. */
  evidence: ClaimEvidence[];
  quoteContext?: QuoteContext;
  confidence: "high" | "medium" | "low";
  verified: boolean;
  verificationStatus: ResearchVerificationStatus;
  verificationReason: string;
};

export type VerifiedResearchClaim = Omit<
  ResearchClaim,
  "verified" | "verificationStatus"
> & {
  verified: true;
  verificationStatus: "verified";
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
  provider: {
    id: string;
    mode: ResearchProviderMode;
  };
  sources: ResearchSource[];
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
        /** Required before any VerifiedEditorialContext can be assembled. */
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
  quoteAttributions?: QuoteAttribution[];
};

export type ValueModuleCollection =
  | [ValueModule, ValueModule]
  | [ValueModule, ValueModule, ValueModule];

export type VerifiedEditorialContext = {
  date: string;
  candidateId: string;
  writer: WriterSummary;
  whyHerToday: VerifiedWhyHerToday;
  /** Only verified claims are exposed beyond the Research boundary. */
  claims: VerifiedResearchClaim[];
  /** Deterministic subset of claims whose category is quote. */
  quoteClaims: VerifiedResearchClaim[];
};

export type QuoteAttribution = {
  claimId: string;
  speakerType: Exclude<QuoteSpeakerType, "unknown">;
  speakerName?: string;
  /** Deterministic display label required in grounded text. */
  label: string;
};

export type DraftTitle = {
  text: string;
  evidenceClaimIds: string[];
  angle: string;
  quoteAttributions?: QuoteAttribution[];
};

export type DraftTitleCollection =
  | [DraftTitle, DraftTitle, DraftTitle]
  | [DraftTitle, DraftTitle, DraftTitle, DraftTitle]
  | [DraftTitle, DraftTitle, DraftTitle, DraftTitle, DraftTitle];

export type DraftBlock = {
  id: string;
  role:
    | "hook"
    | "why_today"
    | "story"
    | "meaning"
    | "value"
    | "interaction";
  text: string;
  evidenceClaimIds: string[];
  quoteAttributions?: QuoteAttribution[];
};

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
  quoteAttributions?: QuoteAttribution[];
};

export type CardPlanCollection =
  | [CardPlan, CardPlan, CardPlan]
  | [CardPlan, CardPlan, CardPlan, CardPlan]
  | [CardPlan, CardPlan, CardPlan, CardPlan, CardPlan]
  | [CardPlan, CardPlan, CardPlan, CardPlan, CardPlan, CardPlan];

export type GrowthNotes = {
  clickReason: string;
  readThroughReason: string;
  saveReason: string;
  commentReason: string;
  followReason: string;
};

export type GroundedDraft = {
  provider: {
    id: string;
    mode: ResearchProviderMode;
  };
  date: string;
  writer: WriterSummary;
  titles: DraftTitleCollection;
  blocks: DraftBlock[];
  /** Deterministically rendered from blocks; never provider-authored. */
  body: string;
  hashtags: string[];
  cards: CardPlanCollection;
  readerHook: string;
  editorialAngle: string;
  status: "draft";
};

export type EditorialIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  relatedIds?: string[];
};

export type ReviewedInputBinding = {
  /** Program-owned canonicalization revision; providers cannot set it. */
  revision: "editorial-review-input/v1";
  algorithm: "sha256";
  /** Binds VerifiedEditorialContext + ValueModules + GroundedDraft. */
  fingerprint: string;
};

export type EditorialReviewResult = {
  provider: {
    id: string;
    mode: ResearchProviderMode;
  };
  growthNotes: GrowthNotes;
  issues: EditorialIssue[];
  recommendation: "ready_for_human_review" | "needs_revision";
  reviewedInputBinding: ReviewedInputBinding;
  status: "draft";
};

export type WriterBrandRules = {
  requiredHashtags: readonly ["#HerLit", "#girltalk", "#她文日历"];
  tone: "specific_restrained_literary";
  autoApprovalAllowed: false;
};

export type WriterInput = {
  context: VerifiedEditorialContext;
  valueModules: ValueModuleCollection;
  style?: string | null;
  brandRules: WriterBrandRules;
};

export type DailyEditorialPackage = {
  date: string;
  selection: EditorialSelectionResult;
  /** Full audit trail; never passed to Writer providers. */
  researchAudit: ResearchPack;
  verifiedContext: VerifiedEditorialContext;
  valueModules: ValueModuleCollection;
  draft: GroundedDraft;
  review: EditorialReviewResult;
  status: "draft";
};
