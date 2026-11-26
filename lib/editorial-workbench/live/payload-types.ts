/**
 * Loose payload shapes produced by live models before domain validation.
 * They mirror the Research contracts but stay local to the transport layer.
 */

import type {
  ClaimEvidence,
  QuoteContext,
  ResearchClaimCategory,
  ResearchSourceType,
} from "../../../types/editorial.ts";

export type MetadataLike = {
  sourceId: string;
  sourceType: ResearchSourceType;
  title: string;
  publisher?: string;
};

export type ProposalLike = {
  id: string;
  claim: string;
  category: ResearchClaimCategory;
  evidence: ClaimEvidence[];
  quoteContext?: QuoteContext;
};

export type FindingLike = {
  evidenceLeadId: string;
  researchClaimIds: string[];
  emptyStatus?: "needs_review" | "rejected";
  note?: string;
};

export type ExtractionPayloadLike = {
  sourceMetadata: MetadataLike[];
  claims: ProposalLike[];
  leadFindings: FindingLike[];
};
