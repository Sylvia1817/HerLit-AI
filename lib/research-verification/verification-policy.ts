import type {
  ResearchClaim,
  ResearchSource,
  ResearchSourceType,
} from "../../types/editorial.ts";
import type { ResearchClaimProposal } from "./contracts.ts";

export type VerificationDecision = Pick<
  ResearchClaim,
  "confidence" | "verified" | "verificationStatus" | "verificationReason"
>;

export const STRONG_SOURCE_TYPES: ReadonlySet<ResearchSourceType> = new Set([
  "official",
  "institution",
  "library",
  "publisher",
]);

function independentSourceKey(source: ResearchSource): string {
  const publisher = source.publisher?.trim().toLocaleLowerCase();
  if (publisher) return `publisher:${publisher}`;
  try {
    return `host:${new URL(source.url).hostname.toLocaleLowerCase()}`;
  } catch {
    return `source:${source.id}`;
  }
}

function rejected(reason: string): VerificationDecision {
  return {
    confidence: "low",
    verified: false,
    verificationStatus: "rejected",
    verificationReason: reason,
  };
}

function needsReview(reason: string): VerificationDecision {
  return {
    confidence: "low",
    verified: false,
    verificationStatus: "needs_review",
    verificationReason: reason,
  };
}

function verified(
  confidence: "high" | "medium",
  reason: string,
): VerificationDecision {
  return {
    confidence,
    verified: true,
    verificationStatus: "verified",
    verificationReason: reason,
  };
}

export function evaluateResearchClaim(
  proposal: ResearchClaimProposal,
  sourcesById: ReadonlyMap<string, ResearchSource>,
): VerificationDecision {
  const evidenceWithSources = proposal.evidence.map((evidence) => ({
    evidence,
    source: sourcesById.get(evidence.sourceId),
  }));

  if (evidenceWithSources.some(({ source }) => !source)) {
    throw new Error(`Claim ${proposal.id} references an unknown source`);
  }
  if (
    evidenceWithSources.some(
      ({ evidence }) => evidence.support === "contradicts",
    )
  ) {
    return needsReview(
      "Conflicting evidence must be resolved; the engine will not choose a version silently.",
    );
  }

  const supportive = evidenceWithSources.filter(
    ({ evidence }) => evidence.support !== "contradicts",
  ) as Array<{
    evidence: ResearchClaimProposal["evidence"][number];
    source: ResearchSource;
  }>;
  if (supportive.length === 0) {
    return rejected("No supporting evidence was found for this claim.");
  }

  const hasDirectStrong = supportive.some(
    ({ evidence, source }) =>
      evidence.support === "direct" &&
      STRONG_SOURCE_TYPES.has(source.sourceType),
  );

  if (proposal.category === "quote") {
    if (!proposal.quoteContext) {
      return rejected("Quote context and speaker attribution are missing.");
    }
    if (proposal.quoteContext.attributionStatus === "misattributed") {
      return rejected(
        "The quotation is misattributed and cannot be presented as the author's words.",
      );
    }
    if (proposal.quoteContext.attributionStatus !== "confirmed") {
      return rejected("The quotation attribution is not confirmed.");
    }
    if (!hasDirectStrong) {
      return rejected(
        "A quote requires direct evidence from an authoritative edition or traceable archive.",
      );
    }
    return verified(
      "high",
      "Direct authoritative evidence confirms the quotation and its speaker context.",
    );
  }

  if (proposal.category === "relationship" || proposal.category === "context") {
    if (hasDirectStrong) {
      return verified(
        "high",
        "A direct strong source supports this contextual claim.",
      );
    }
    const reputableSourceKeys = new Set(
      supportive
        .filter(({ source }) => source.sourceType === "reputable_media")
        .map(({ source }) => independentSourceKey(source)),
    );
    if (reputableSourceKeys.size >= 2) {
      return verified(
        "medium",
        "Two independent reputable secondary sources support this contextual claim.",
      );
    }
    return needsReview(
      "Contextual claims need one direct strong source or two independent reputable sources.",
    );
  }

  if (hasDirectStrong) {
    return verified("high", "A direct strong source supports this claim.");
  }

  return needsReview(
    "The available evidence does not meet the direct strong-source threshold.",
  );
}
