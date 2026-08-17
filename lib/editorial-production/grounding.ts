import type {
  QuoteAttribution,
  QuoteSpeakerType,
  VerifiedResearchClaim,
} from "../../types/editorial.ts";

export function verifiedClaimMap(
  claims: readonly VerifiedResearchClaim[],
): Map<string, VerifiedResearchClaim> {
  return new Map(claims.map((claim) => [claim.id, claim]));
}

export function assertGroundedClaimIds(
  label: string,
  claimIds: readonly string[],
  claimsById: ReadonlyMap<string, VerifiedResearchClaim>,
): void {
  if (new Set(claimIds).size !== claimIds.length) {
    throw new Error(`${label} evidenceClaimIds must be unique`);
  }
  for (const claimId of claimIds) {
    if (!claimsById.has(claimId)) {
      throw new Error(`${label} references unavailable claim ${claimId}`);
    }
  }
}

function quoteLabel(
  speakerType: Exclude<QuoteSpeakerType, "unknown">,
  speakerName?: string,
): string {
  if (speakerType === "author") {
    return speakerName ? `作者「${speakerName}」本人说` : "作者本人说";
  }
  if (speakerType === "character") {
    return speakerName ? `书中人物「${speakerName}」说` : "书中人物说";
  }
  if (speakerType === "narrator") return "叙述者文本";
  return speakerName
    ? `来源中的说话者「${speakerName}」说`
    : "来源中的说话者说";
}

export function buildQuoteAttribution(
  claim: VerifiedResearchClaim,
): QuoteAttribution {
  if (claim.category !== "quote" || !claim.quoteContext) {
    throw new Error(`Claim ${claim.id} is not a grounded quote claim`);
  }
  const contexts = claim.evidence
    .map(({ quoteSpeakerContext }) => quoteSpeakerContext)
    .filter(
      (context): context is NonNullable<typeof context> =>
        Boolean(context) && context?.speakerType !== "unknown",
    );
  if (contexts.length === 0) {
    throw new Error(`Quote claim ${claim.id} has no verified speaker context`);
  }
  const speakerType = contexts[0].speakerType;
  if (
    speakerType === "unknown" ||
    contexts.some((context) => context.speakerType !== speakerType)
  ) {
    throw new Error(`Quote claim ${claim.id} has inconsistent speaker context`);
  }
  const speakerName =
    claim.quoteContext.attributedSpeakerName ?? contexts[0].speakerName;
  return {
    claimId: claim.id,
    speakerType,
    speakerName,
    label: quoteLabel(speakerType, speakerName),
  };
}

export function assertQuoteGrounding(
  label: string,
  text: string,
  evidenceClaimIds: readonly string[],
  quoteAttributions: readonly QuoteAttribution[] | undefined,
  claimsById: ReadonlyMap<string, VerifiedResearchClaim>,
): void {
  const quoteClaims = evidenceClaimIds
    .map((claimId) => claimsById.get(claimId)!)
    .filter(({ category }) => category === "quote");
  const actualAttributions = quoteAttributions ?? [];
  if (new Set(actualAttributions.map(({ claimId }) => claimId)).size !== actualAttributions.length) {
    throw new Error(`${label} quote attributions must use unique claim IDs`);
  }
  if (actualAttributions.length !== quoteClaims.length) {
    throw new Error(`${label} must preserve every quote speaker attribution`);
  }

  for (const claim of quoteClaims) {
    const expected = buildQuoteAttribution(claim);
    const actual = actualAttributions.find(({ claimId }) => claimId === claim.id);
    if (
      !actual ||
      actual.speakerType !== expected.speakerType ||
      actual.speakerName !== expected.speakerName ||
      actual.label !== expected.label
    ) {
      throw new Error(
        `${label} changes the verified speaker attribution for quote ${claim.id}`,
      );
    }
    if (!text.includes(expected.label)) {
      throw new Error(`${label} must display quote attribution ${expected.label}`);
    }
  }
}
