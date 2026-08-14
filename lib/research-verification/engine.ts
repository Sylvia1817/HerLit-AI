import type {
  Candidate,
  EvidenceLeadResolution,
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

function isReadyForDraft(
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

function toVerifiedWhyHerToday(
  candidate: Candidate,
  resolutions: readonly EvidenceLeadResolution[],
): VerifiedWhyHerToday | undefined {
  if (
    resolutions.length === 0 ||
    !resolutions.every(({ status }) => status === "verified")
  ) {
    return undefined;
  }
  const evidenceClaimIds = [
    ...new Set(resolutions.flatMap(({ researchClaimIds }) => researchClaimIds)),
  ];
  if (evidenceClaimIds.length === 0) return undefined;

  const proposed = candidate.proposedWhyHerToday;
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

  if (pack.verifiedWhyHerToday) {
    const evidenceClaimIds = pack.verifiedWhyHerToday.evidenceClaimIds;
    assertUniqueIds("VerifiedWhyHerToday evidenceClaimIds", evidenceClaimIds);
    if (evidenceClaimIds.length === 0) {
      throw new Error("VerifiedWhyHerToday must reference at least one claim");
    }
    for (const claimId of evidenceClaimIds) {
      const claim = claimsById.get(claimId);
      if (!claim || !claim.verified) {
        throw new Error(
          `VerifiedWhyHerToday references unverified claim ${claimId}`,
        );
      }
    }
    const proposed = pack.proposedWhyHerToday;
    const verifiedWhy = pack.verifiedWhyHerToday;
    if (
      verifiedWhy.relationType !== proposed.relationType ||
      verifiedWhy.relationDate !== proposed.relationDate ||
      verifiedWhy.tier !== proposed.tier ||
      verifiedWhy.isEditorialLink !== proposed.isEditorialLink ||
      verifiedWhy.shortReason !== proposed.shortReason ||
      verifiedWhy.editorExplanation !== proposed.editorExplanation
    ) {
      throw new Error("VerifiedWhyHerToday does not match the proposed relation");
    }
  }

  if (
    pack.readyForDraft &&
    !isReadyForDraft(pack.claims, pack.verifiedWhyHerToday)
  ) {
    throw new Error(
      "readyForDraft requires verified date, bio, work and at least four verified claims",
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
    const verifiedWhyHerToday = toVerifiedWhyHerToday(
      candidate,
      evidenceLeadResolutions,
    );
    const readyForDraft = isReadyForDraft(claims, verifiedWhyHerToday);

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
