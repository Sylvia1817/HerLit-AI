import type {
  Candidate,
  EvidenceLeadResolution,
  ProposedWhyHerToday,
  ResearchClaim,
  ResearchPack,
  ResearchVerificationStatus,
  VerifiedWhyHerToday,
} from "../../types/editorial.ts";
import type {
  EvidenceLeadFinding,
  ResearchClaimProposal,
  ResearchEvidenceProvider,
  ResearchInvestigation,
} from "./contracts.ts";
import { evaluateResearchClaim } from "./verification-policy.ts";

const MINIMUM_VERIFIED_CLAIMS_FOR_DRAFT = 4;

function assertUniqueIds(label: string, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} must contain unique IDs`);
  }
}

function setsMatch(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function resolutionStatus(
  finding: EvidenceLeadFinding,
  claimsById: ReadonlyMap<string, ResearchClaim>,
): ResearchVerificationStatus {
  if (finding.researchClaimIds.length === 0) {
    return finding.emptyStatus ?? "needs_review";
  }
  const statuses = finding.researchClaimIds.map(
    (claimId) => claimsById.get(claimId)!.verificationStatus,
  );
  if (statuses.every((status) => status === "verified")) return "verified";
  if (statuses.every((status) => status === "rejected")) return "rejected";
  return "needs_review";
}

export function calculateReadyForDraft(
  claims: readonly ResearchClaim[],
  verifiedWhyHerToday: VerifiedWhyHerToday | undefined,
): boolean {
  const verifiedClaims = claims.filter(({ verified }) => verified);
  return Boolean(
    verifiedWhyHerToday &&
      verifiedClaims.length >= MINIMUM_VERIFIED_CLAIMS_FOR_DRAFT &&
      verifiedClaims.some(({ category }) => category === "bio") &&
      verifiedClaims.some(({ category }) => category === "work"),
  );
}

function assertInvestigation(
  candidate: Candidate,
  provider: ResearchEvidenceProvider,
  investigation: ResearchInvestigation,
): void {
  const sourceIds = investigation.sources.map(({ id }) => id);
  const claimIds = investigation.claimProposals.map(({ id }) => id);
  const leadIds = candidate.proposedWhyHerToday.evidenceLeads.map(({ id }) => id);
  const findingLeadIds = investigation.leadFindings.map(
    ({ evidenceLeadId }) => evidenceLeadId,
  );

  assertUniqueIds("Research sources", sourceIds);
  assertUniqueIds("Research claim proposals", claimIds);
  assertUniqueIds("Selection evidence leads", leadIds);
  assertUniqueIds("Evidence lead findings", findingLeadIds);

  const sourceIdSet = new Set(sourceIds);
  const claimIdSet = new Set(claimIds);
  for (const source of investigation.sources) {
    if (
      source.providerId !== provider.id ||
      source.providerMode !== provider.mode
    ) {
      throw new Error(`Source ${source.id} has inconsistent provider provenance`);
    }
  }
  for (const proposal of investigation.claimProposals) {
    for (const evidence of proposal.evidence) {
      if (!sourceIdSet.has(evidence.sourceId)) {
        throw new Error(
          `Claim ${proposal.id} references unknown source ${evidence.sourceId}`,
        );
      }
    }
  }
  for (const finding of investigation.leadFindings) {
    assertUniqueIds(
      `Resolution for evidence lead ${finding.evidenceLeadId}`,
      finding.researchClaimIds,
    );
    for (const claimId of finding.researchClaimIds) {
      if (!claimIdSet.has(claimId)) {
        throw new Error(
          `Evidence lead ${finding.evidenceLeadId} references unknown claim ${claimId}`,
        );
      }
    }
  }
  if (!setsMatch(new Set(leadIds), new Set(findingLeadIds))) {
    throw new Error("Every Evidence Lead must have exactly one finding");
  }
}

export function rebuildVerifiedWhyHerToday(
  proposed: ProposedWhyHerToday,
  resolutions: readonly EvidenceLeadResolution[],
  claims: readonly ResearchClaim[],
): VerifiedWhyHerToday | undefined {
  const resolutionsByLeadId = new Map(
    resolutions.map((resolution) => [resolution.evidenceLeadId, resolution]),
  );
  const orderedResolutions = proposed.evidenceLeads.map(({ id }) =>
    resolutionsByLeadId.get(id),
  );
  if (
    orderedResolutions.length === 0 ||
    orderedResolutions.some(
      (resolution) => !resolution || resolution.status !== "verified",
    )
  ) {
    return undefined;
  }
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const evidenceClaimIds = [
    ...new Set(
      orderedResolutions.flatMap(
        (resolution) => resolution?.researchClaimIds ?? [],
      ),
    ),
  ];
  if (
    evidenceClaimIds.length === 0 ||
    evidenceClaimIds.some((claimId) => {
      const claim = claimsById.get(claimId);
      return !claim?.verified || claim.verificationStatus !== "verified";
    })
  ) {
    return undefined;
  }

  return {
    relationType: proposed.relationType,
    relationDate: proposed.relationDate,
    tier: proposed.tier,
    isEditorialLink: proposed.isEditorialLink,
    shortReason: proposed.shortReason,
    editorExplanation: proposed.editorExplanation,
    evidenceClaimIds,
  };
}

function whyHerTodayMatches(
  actual: VerifiedWhyHerToday,
  expected: VerifiedWhyHerToday,
): boolean {
  return (
    actual.relationType === expected.relationType &&
    actual.relationDate === expected.relationDate &&
    actual.tier === expected.tier &&
    actual.isEditorialLink === expected.isEditorialLink &&
    actual.shortReason === expected.shortReason &&
    actual.editorExplanation === expected.editorExplanation &&
    actual.evidenceClaimIds.length === expected.evidenceClaimIds.length &&
    actual.evidenceClaimIds.every(
      (claimId, index) => claimId === expected.evidenceClaimIds[index],
    )
  );
}

function claimProposalFromClaim(claim: ResearchClaim): ResearchClaimProposal {
  return {
    id: claim.id,
    claim: claim.claim,
    category: claim.category,
    evidence: claim.evidence,
    quoteContext: claim.quoteContext,
  };
}

export function assertResearchPack(
  pack: ResearchPack,
): asserts pack is ResearchPack {
  const sourceIds = pack.sources.map(({ id }) => id);
  const claimIds = pack.claims.map(({ id }) => id);
  assertUniqueIds("Research sources", sourceIds);
  assertUniqueIds("Research claims", claimIds);

  const sourceIdSet = new Set(sourceIds);
  const claimIdSet = new Set(claimIds);
  const sourcesById = new Map(pack.sources.map((source) => [source.id, source]));
  const claimsById = new Map(pack.claims.map((claim) => [claim.id, claim]));

  for (const source of pack.sources) {
    if (
      source.providerId !== pack.provider.id ||
      source.providerMode !== pack.provider.mode
    ) {
      throw new Error(`Source ${source.id} does not match pack provider`);
    }
  }
  for (const claim of pack.claims) {
    for (const evidence of claim.evidence) {
      if (!sourceIdSet.has(evidence.sourceId)) {
        throw new Error(
          `Claim ${claim.id} references unknown source ${evidence.sourceId}`,
        );
      }
    }
    const expected = evaluateResearchClaim(
      claimProposalFromClaim(claim),
      sourcesById,
    );
    if (
      claim.verified !== expected.verified ||
      claim.confidence !== expected.confidence ||
      claim.verificationStatus !== expected.verificationStatus ||
      claim.verificationReason !== expected.verificationReason
    ) {
      throw new Error(`Claim ${claim.id} does not match verification policy`);
    }
  }

  const buckets: Array<{
    label: string;
    ids: string[];
    status: ResearchVerificationStatus;
  }> = [
    {
      label: "passedClaimIds",
      ids: pack.verification.passedClaimIds,
      status: "verified",
    },
    {
      label: "needsReviewClaimIds",
      ids: pack.verification.needsReviewClaimIds,
      status: "needs_review",
    },
    {
      label: "rejectedClaimIds",
      ids: pack.verification.rejectedClaimIds,
      status: "rejected",
    },
  ];
  const partitionIds = buckets.flatMap(({ ids }) => ids);
  assertUniqueIds("Verification claim partitions", partitionIds);
  if (!setsMatch(new Set(partitionIds), claimIdSet)) {
    throw new Error("Verification claim partitions must cover every claim once");
  }
  for (const { label, ids, status } of buckets) {
    for (const id of ids) {
      const claim = claimsById.get(id);
      if (!claim) throw new Error(`${label} references unknown claim ${id}`);
      if (claim.verificationStatus !== status) {
        throw new Error(`${label} contains a claim with the wrong status`);
      }
      if ((status === "verified") !== claim.verified) {
        throw new Error(`${label} has an inconsistent verified flag`);
      }
    }
  }

  const leadIds = pack.proposedWhyHerToday.evidenceLeads.map(({ id }) => id);
  const resolutionLeadIds = pack.evidenceLeadResolutions.map(
    ({ evidenceLeadId }) => evidenceLeadId,
  );
  assertUniqueIds("Selection evidence leads", leadIds);
  assertUniqueIds("Evidence Lead resolutions", resolutionLeadIds);
  if (!setsMatch(new Set(leadIds), new Set(resolutionLeadIds))) {
    throw new Error("Every Evidence Lead must have exactly one resolution");
  }
  for (const resolution of pack.evidenceLeadResolutions) {
    assertUniqueIds(
      `Resolution for evidence lead ${resolution.evidenceLeadId}`,
      resolution.researchClaimIds,
    );
    for (const claimId of resolution.researchClaimIds) {
      if (!claimIdSet.has(claimId)) {
        throw new Error(
          `Evidence Lead resolution references unknown claim ${claimId}`,
        );
      }
    }
    const finding: EvidenceLeadFinding = {
      evidenceLeadId: resolution.evidenceLeadId,
      researchClaimIds: resolution.researchClaimIds,
      emptyStatus:
        resolution.researchClaimIds.length === 0
          ? resolution.status === "rejected"
            ? "rejected"
            : "needs_review"
          : undefined,
    };
    if (resolution.status !== resolutionStatus(finding, claimsById)) {
      throw new Error(
        `Evidence Lead ${resolution.evidenceLeadId} has an inconsistent status`,
      );
    }
  }

  const expectedWhyHerToday = rebuildVerifiedWhyHerToday(
    pack.proposedWhyHerToday,
    pack.evidenceLeadResolutions,
    pack.claims,
  );
  if (
    Boolean(pack.verifiedWhyHerToday) !== Boolean(expectedWhyHerToday) ||
    (pack.verifiedWhyHerToday &&
      expectedWhyHerToday &&
      !whyHerTodayMatches(pack.verifiedWhyHerToday, expectedWhyHerToday))
  ) {
    throw new Error(
      "VerifiedWhyHerToday must equal the deterministic reconstruction from Evidence Lead resolutions and verified claims",
    );
  }

  const expectedReadyForDraft = calculateReadyForDraft(
    pack.claims,
    expectedWhyHerToday,
  );
  if (pack.readyForDraft !== expectedReadyForDraft) {
    throw new Error(
      `readyForDraft must equal deterministic eligibility result ${expectedReadyForDraft}`,
    );
  }
}

export class ResearchVerificationEngine {
  private readonly evidenceProvider: ResearchEvidenceProvider;

  constructor(evidenceProvider: ResearchEvidenceProvider) {
    this.evidenceProvider = evidenceProvider;
  }

  async research(candidate: Candidate): Promise<ResearchPack> {
    const investigation = await this.evidenceProvider.investigate(candidate);
    assertInvestigation(candidate, this.evidenceProvider, investigation);

    const sourcesById = new Map(
      investigation.sources.map((source) => [source.id, source]),
    );
    const claims: ResearchClaim[] = investigation.claimProposals.map(
      (proposal) => ({
        ...proposal,
        ...evaluateResearchClaim(proposal, sourcesById),
      }),
    );
    const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
    const evidenceLeadResolutions: EvidenceLeadResolution[] =
      investigation.leadFindings.map((finding) => ({
        evidenceLeadId: finding.evidenceLeadId,
        status: resolutionStatus(finding, claimsById),
        researchClaimIds: [...finding.researchClaimIds],
        note: finding.note,
      }));
    const verifiedWhyHerToday = rebuildVerifiedWhyHerToday(
      candidate.proposedWhyHerToday,
      evidenceLeadResolutions,
      claims,
    );
    const readyForDraft = calculateReadyForDraft(claims, verifiedWhyHerToday);

    const base = {
      candidateId: candidate.id,
      writer: structuredClone(candidate.writer),
      proposedWhyHerToday: structuredClone(candidate.proposedWhyHerToday),
      provider: {
        id: this.evidenceProvider.id,
        mode: this.evidenceProvider.mode,
      },
      sources: structuredClone(investigation.sources),
      evidenceLeadResolutions,
      claims,
      verification: {
        passedClaimIds: claims
          .filter(({ verificationStatus }) => verificationStatus === "verified")
          .map(({ id }) => id),
        needsReviewClaimIds: claims
          .filter(
            ({ verificationStatus }) => verificationStatus === "needs_review",
          )
          .map(({ id }) => id),
        rejectedClaimIds: claims
          .filter(({ verificationStatus }) => verificationStatus === "rejected")
          .map(({ id }) => id),
      },
    };
    const pack: ResearchPack = readyForDraft
      ? { ...base, readyForDraft: true, verifiedWhyHerToday: verifiedWhyHerToday! }
      : { ...base, readyForDraft: false, verifiedWhyHerToday };

    assertResearchPack(pack);
    return pack;
  }
}
