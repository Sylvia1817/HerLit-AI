import type {
  Candidate,
  ClaimEvidence,
  QuoteContext,
  ResearchClaimCategory,
  ResearchProviderMode,
  ResearchSource,
  SkippedResearchSource,
} from "../../types/editorial.ts";

export type ResearchClaimProposal = {
  id: string;
  claim: string;
  category: ResearchClaimCategory;
  evidence: ClaimEvidence[];
  quoteContext?: QuoteContext;
};

export type EvidenceLeadFinding = {
  evidenceLeadId: string;
  researchClaimIds: string[];
  /** Required only when no claims were produced for this lead. */
  emptyStatus?: "needs_review" | "rejected";
  note?: string;
};

export type ResearchInvestigation = {
  sources: ResearchSource[];
  claimProposals: ResearchClaimProposal[];
  leadFindings: EvidenceLeadFinding[];
  skippedSources?: SkippedResearchSource[];
};

export interface ResearchEvidenceProvider {
  readonly id: string;
  readonly mode: ResearchProviderMode;

  investigate(candidate: Candidate): Promise<ResearchInvestigation>;
}
