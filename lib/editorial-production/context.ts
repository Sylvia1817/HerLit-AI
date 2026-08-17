import type {
  ResearchPack,
  VerifiedEditorialContext,
  VerifiedResearchClaim,
} from "../../types/editorial.ts";
import { assertResearchPack } from "../research-verification/index.ts";

function assertUniqueIds(label: string, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} must contain unique IDs`);
  }
}

function isVerifiedClaim(
  claim: ResearchPack["claims"][number],
): claim is VerifiedResearchClaim {
  return claim.verified && claim.verificationStatus === "verified";
}

function claimSnapshotsMatch(
  actual: readonly VerifiedResearchClaim[],
  expected: readonly VerifiedResearchClaim[],
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function assertVerifiedEditorialContext(
  context: VerifiedEditorialContext,
): asserts context is VerifiedEditorialContext {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(context.date)) {
    throw new Error("VerifiedEditorialContext.date must use YYYY-MM-DD");
  }
  const claimIds = context.claims.map(({ id }) => id);
  const quoteClaimIds = context.quoteClaims.map(({ id }) => id);
  assertUniqueIds("VerifiedEditorialContext claims", claimIds);
  assertUniqueIds("VerifiedEditorialContext quoteClaims", quoteClaimIds);

  if (
    context.claims.some(
      (claim) => !claim.verified || claim.verificationStatus !== "verified",
    )
  ) {
    throw new Error("VerifiedEditorialContext may contain only verified claims");
  }
  const expectedQuoteClaims = context.claims.filter(
    ({ category }) => category === "quote",
  );
  if (!claimSnapshotsMatch(context.quoteClaims, expectedQuoteClaims)) {
    throw new Error("quoteClaims must equal the deterministic quote subset");
  }

  const claimIdSet = new Set(claimIds);
  for (const claimId of context.whyHerToday.evidenceClaimIds) {
    if (!claimIdSet.has(claimId)) {
      throw new Error(
        `VerifiedWhyHerToday references claim ${claimId} outside Writer context`,
      );
    }
  }
}

export function buildVerifiedEditorialContext(
  pack: ResearchPack,
  date: string,
): VerifiedEditorialContext {
  assertResearchPack(pack);
  if (!pack.readyForDraft || !pack.verifiedWhyHerToday) {
    throw new Error(
      "VerifiedEditorialContext requires a ResearchPack with readyForDraft=true",
    );
  }

  const claims = pack.claims.filter(isVerifiedClaim).map((claim) =>
    structuredClone(claim),
  );
  const context: VerifiedEditorialContext = {
    date,
    candidateId: pack.candidateId,
    writer: structuredClone(pack.writer),
    whyHerToday: structuredClone(pack.verifiedWhyHerToday),
    claims,
    quoteClaims: claims
      .filter(({ category }) => category === "quote")
      .map((claim) => structuredClone(claim)),
  };

  assertVerifiedEditorialContext(context);
  return context;
}

export function verifiedContextsMatch(
  actual: VerifiedEditorialContext,
  expected: VerifiedEditorialContext,
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
