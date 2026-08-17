import assert from "node:assert/strict";
import test from "node:test";

import type {
  Candidate,
  ClaimEvidence,
  EvidenceLead,
  QuoteContext,
  QuoteSourceContext,
  ResearchClaimCategory,
  ResearchPack,
  ResearchSourceType,
} from "../types/editorial.ts";
import {
  MockResearchEvidenceProvider,
  ResearchVerificationEngine,
  assertResearchPack,
} from "../lib/research-verification/index.ts";
import type {
  MockResearchFixture,
  MockResearchSource,
  ResearchClaimProposal,
} from "../lib/research-verification/index.ts";

const RETRIEVED_AT = "2026-08-14T08:00:00.000Z";

function evidenceLead(id = "lead-date"): EvidenceLead {
  return {
    id,
    description: `核验 ${id}`,
    expectedSourceType: "institution",
    searchHint: id,
  };
}

function selectedCandidate(
  id: string,
  leads: EvidenceLead[] = [evidenceLead()],
): Candidate {
  return {
    id,
    writer: {
      id: `writer-${id}`,
      name: `作家 ${id}`,
      originalName: `Writer ${id}`,
      knownFor: ["代表作"],
    },
    proposedWhyHerToday: {
      relationType: "birth",
      relationDate: "1900-08-14",
      tier: "A",
      isEditorialLink: false,
      shortReason: "今天是她的诞辰",
      editorExplanation: "待 Research 核验的日期关系",
      evidenceLeads: leads,
    },
    signals: {
      dateRelevance: 90,
      sourceAvailability: 85,
      recognition: 70,
      storyTension: 75,
      readerValue: 80,
      growthPotential: 70,
      herlitDistinctiveness: 80,
    },
    score: {
      weightedBase: 80,
      recentRepeatPenalty: 0,
      weightedTotal: 80,
    },
    provenance: {
      providerId: "mock-selection-provider",
      providerMode: "mock",
    },
    rank: 1,
    editorialReason: "测试候选",
    risks: ["需要 Research"],
  };
}

function source(
  id: string,
  sourceType: ResearchSourceType,
  title = `Source ${id}`,
): MockResearchSource {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    publisher: `Publisher ${id}`,
    sourceType,
    retrievedAt: RETRIEVED_AT,
  };
}

function claim(
  id: string,
  category: ResearchClaimCategory,
  evidence: ClaimEvidence[],
  quoteContext?: QuoteContext,
): ResearchClaimProposal {
  return {
    id,
    claim: `Claim ${id}`,
    category,
    evidence,
    quoteContext,
  };
}

async function research(
  candidate: Candidate,
  fixture: MockResearchFixture,
): Promise<ResearchPack> {
  const provider = new MockResearchEvidenceProvider({
    [candidate.id]: fixture,
  });
  const engine = new ResearchVerificationEngine(provider);
  const pack = await engine.research(candidate);
  assert.deepEqual(provider.calls, [candidate.id]);
  return pack;
}

function direct(
  sourceId: string,
  quoteSpeakerContext?: QuoteSourceContext,
): ClaimEvidence {
  return {
    sourceId,
    support: "direct",
    locator: "p. 1",
    quoteSpeakerContext,
  };
}

function completeFixture(): {
  candidate: Candidate;
  fixture: MockResearchFixture;
} {
  const candidate = selectedCandidate("complete");
  return {
    candidate,
    fixture: {
      sources: [source("archive", "institution")],
      claimProposals: [
        claim("date", "date_event", [direct("archive")]),
        claim("bio", "bio", [direct("archive")]),
        claim("work", "work", [direct("archive")]),
        claim("context", "context", [direct("archive")]),
      ],
      leadFindings: [
        {
          evidenceLeadId: "lead-date",
          researchClaimIds: ["date"],
        },
      ],
    },
  };
}

test("R1: an authoritative source verifies a birth-date claim", async () => {
  const candidate = selectedCandidate("r1");
  const pack = await research(candidate, {
    sources: [source("official-bio", "official")],
    claimProposals: [
      claim("birth-date", "bio", [direct("official-bio")]),
    ],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["birth-date"] },
    ],
  });

  assert.equal(pack.claims[0].verified, true);
  assert.equal(pack.claims[0].confidence, "high");
  assert.deepEqual(pack.verification.passedClaimIds, ["birth-date"]);
  assert.equal(pack.provider.mode, "mock");
  assert.equal(pack.sources[0].providerMode, "mock");
});

test("R2: library and publisher evidence verifies a work year", async () => {
  const candidate = selectedCandidate("r2");
  const pack = await research(candidate, {
    sources: [
      source("catalog", "library"),
      source("publisher-record", "publisher"),
    ],
    claimProposals: [
      claim("first-edition", "work", [
        direct("catalog"),
        direct("publisher-record"),
      ]),
    ],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["first-edition"] },
    ],
  });

  assert.equal(pack.claims[0].verified, true);
  assert.equal(pack.claims[0].evidence.length, 2);
});

test("R3: a secondary quote site cannot verify a quotation", async () => {
  const candidate = selectedCandidate("r3");
  const pack = await research(candidate, {
    sources: [source("quote-aggregator", "secondary", "Quote Aggregator")],
    claimProposals: [
      claim(
        "quote",
        "quote",
        [
          direct("quote-aggregator", {
            speakerType: "author",
            speakerName: "Writer r3",
          }),
        ],
        {
          attributedSpeakerType: "author",
          attributedSpeakerName: "Writer r3",
        },
      ),
    ],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["quote"] },
    ],
  });

  assert.equal(pack.claims[0].verificationStatus, "rejected");
  assert.deepEqual(pack.verification.rejectedClaimIds, ["quote"]);
});

test("R4: character dialogue misattributed to the author is rejected", async () => {
  const candidate = selectedCandidate("r4");
  const pack = await research(candidate, {
    sources: [source("authoritative-edition", "publisher")],
    claimProposals: [
      claim(
        "misattributed-quote",
        "quote",
        [
          direct("authoritative-edition", {
            speakerType: "character",
            speakerName: "小说人物",
            documentType: "work",
            workOrDocument: "小说原作",
            locator: "第 3 章",
          }),
        ],
        {
          attributedSpeakerType: "author",
          attributedSpeakerName: "Writer r4",
        },
      ),
    ],
    leadFindings: [
      {
        evidenceLeadId: "lead-date",
        researchClaimIds: ["misattributed-quote"],
      },
    ],
  });

  assert.equal(pack.claims[0].verificationStatus, "rejected");
  assert.match(pack.claims[0].verificationReason, /source identifies character/);
});

test("quote policy rejects narrator text attributed to the author", async () => {
  const candidate = selectedCandidate("quote-narrator");
  const pack = await research(candidate, {
    sources: [source("authoritative-edition", "publisher")],
    claimProposals: [
      claim(
        "narrator-quote",
        "quote",
        [
          direct("authoritative-edition", {
            speakerType: "narrator",
            documentType: "work",
            workOrDocument: "小说原作",
            locator: "第 1 章",
          }),
        ],
        {
          attributedSpeakerType: "author",
          attributedSpeakerName: "Writer quote-narrator",
        },
      ),
    ],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["narrator-quote"] },
    ],
  });

  assert.equal(pack.claims[0].verificationStatus, "rejected");
  assert.match(pack.claims[0].verificationReason, /source identifies narrator/);
});

test("quote policy verifies a character quote only when labeled as character", async () => {
  const candidate = selectedCandidate("quote-character");
  const pack = await research(candidate, {
    sources: [source("authoritative-edition", "publisher")],
    claimProposals: [
      claim(
        "character-quote",
        "quote",
        [
          direct("authoritative-edition", {
            speakerType: "character",
            speakerName: "主人公",
            documentType: "work",
            workOrDocument: "小说原作",
            locator: "第 2 章",
          }),
        ],
        {
          attributedSpeakerType: "character",
          attributedSpeakerName: "主人公",
        },
      ),
    ],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["character-quote"] },
    ],
  });

  assert.equal(pack.claims[0].verificationStatus, "verified");
  assert.match(pack.claims[0].verificationReason, /speaker as character/);
});

test("R5: contradictory credible sources require review", async () => {
  const candidate = selectedCandidate("r5");
  const pack = await research(candidate, {
    sources: [source("library-a", "library"), source("archive-b", "institution")],
    claimProposals: [
      claim("publication-year", "work", [
        direct("library-a"),
        { sourceId: "archive-b", support: "contradicts", locator: "record 2" },
      ]),
    ],
    leadFindings: [
      {
        evidenceLeadId: "lead-date",
        researchClaimIds: ["publication-year"],
      },
    ],
  });

  assert.equal(pack.claims[0].verified, false);
  assert.equal(pack.claims[0].verificationStatus, "needs_review");
  assert.match(pack.claims[0].verificationReason, /Conflicting evidence/);
});

test("R6: a lead with no evidence still receives one resolution", async () => {
  const candidate = selectedCandidate("r6");
  const pack = await research(candidate, {
    sources: [],
    claimProposals: [],
    leadFindings: [
      {
        evidenceLeadId: "lead-date",
        researchClaimIds: [],
        emptyStatus: "needs_review",
        note: "No reliable evidence found",
      },
    ],
  });

  assert.deepEqual(pack.evidenceLeadResolutions, [
    {
      evidenceLeadId: "lead-date",
      status: "needs_review",
      researchClaimIds: [],
      note: "No reliable evidence found",
    },
  ]);
  assert.equal(pack.verifiedWhyHerToday, undefined);
});

test("R7: one Evidence Lead may resolve to multiple claims", async () => {
  const candidate = selectedCandidate("r7");
  const pack = await research(candidate, {
    sources: [source("archive", "institution")],
    claimProposals: [
      claim("event", "date_event", [direct("archive")]),
      claim("related-work", "work", [direct("archive")]),
    ],
    leadFindings: [
      {
        evidenceLeadId: "lead-date",
        researchClaimIds: ["event", "related-work"],
      },
    ],
  });

  assert.equal(pack.evidenceLeadResolutions[0].status, "verified");
  assert.deepEqual(pack.evidenceLeadResolutions[0].researchClaimIds, [
    "event",
    "related-work",
  ]);
});

test("R8: insufficient date-link evidence blocks VerifiedWhyHerToday", async () => {
  const candidate = selectedCandidate("r8");
  const pack = await research(candidate, {
    sources: [source("secondary", "secondary")],
    claimProposals: [claim("date", "date_event", [direct("secondary")])],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["date"] },
    ],
  });

  assert.equal(pack.claims[0].verificationStatus, "needs_review");
  assert.equal(pack.verifiedWhyHerToday, undefined);
  assert.equal(pack.readyForDraft, false);
});

test("R9: a verified date link without a verified work is not draft-ready", async () => {
  const candidate = selectedCandidate("r9");
  const pack = await research(candidate, {
    sources: [source("archive", "institution")],
    claimProposals: [
      claim("date", "date_event", [direct("archive")]),
      claim("bio", "bio", [direct("archive")]),
      claim("context", "context", [direct("archive")]),
    ],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["date"] },
    ],
  });

  assert.ok(pack.verifiedWhyHerToday);
  assert.equal(pack.readyForDraft, false);
  assert.equal(pack.claims.some(({ category }) => category === "work"), false);
});

test("R10: a complete pack with date, bio, work and four facts is draft-ready", async () => {
  const { candidate, fixture } = completeFixture();
  const pack = await research(candidate, fixture);

  assert.equal(pack.readyForDraft, true);
  assert.deepEqual(pack.verifiedWhyHerToday.evidenceClaimIds, ["date"]);
  assert.equal(pack.verification.passedClaimIds.length, 4);
  assert.equal(pack.claims.some(({ category }) => category === "quote"), false);
});

test("R11: ResearchPack invariants survive structured cloning", async () => {
  const { candidate, fixture } = completeFixture();
  const pack = await research(candidate, fixture);

  assert.doesNotThrow(() => assertResearchPack(structuredClone(pack)));
});

test("VerifiedWhyHerToday rebuild uses canonical Evidence Lead order", async () => {
  const candidate = selectedCandidate("ordered-why", [
    evidenceLead("lead-first"),
    evidenceLead("lead-second"),
  ]);
  const pack = await research(candidate, {
    sources: [source("archive", "institution")],
    claimProposals: [
      claim("claim-first", "date_event", [direct("archive")]),
      claim("claim-second", "context", [direct("archive")]),
    ],
    leadFindings: [
      {
        evidenceLeadId: "lead-second",
        researchClaimIds: ["claim-second"],
      },
      {
        evidenceLeadId: "lead-first",
        researchClaimIds: ["claim-first"],
      },
    ],
  });

  assert.deepEqual(pack.verifiedWhyHerToday?.evidenceClaimIds, [
    "claim-first",
    "claim-second",
  ]);
});

test("VerifiedWhyHerToday must equal its deterministic reconstruction", async () => {
  const { candidate, fixture } = completeFixture();
  const pack = await research(candidate, fixture);
  const forged = structuredClone(pack);
  if (!forged.verifiedWhyHerToday) {
    throw new Error("Complete fixture must produce VerifiedWhyHerToday");
  }
  forged.verifiedWhyHerToday.evidenceClaimIds = ["bio"];

  assert.throws(
    () => assertResearchPack(forged),
    /must equal the deterministic reconstruction/,
  );
});

test("readyForDraft rejects both false positives and false negatives", async () => {
  const { candidate, fixture } = completeFixture();
  const eligiblePack = await research(candidate, fixture);
  const falseNegative = structuredClone(eligiblePack);
  (falseNegative as { readyForDraft: boolean }).readyForDraft = false;
  assert.throws(
    () => assertResearchPack(falseNegative),
    /deterministic eligibility result true/,
  );

  const incompleteCandidate = selectedCandidate("not-ready");
  const incompletePack = await research(incompleteCandidate, {
    sources: [source("archive", "institution")],
    claimProposals: [
      claim("date", "date_event", [direct("archive")]),
      claim("bio", "bio", [direct("archive")]),
      claim("context", "context", [direct("archive")]),
    ],
    leadFindings: [
      { evidenceLeadId: "lead-date", researchClaimIds: ["date"] },
    ],
  });
  const falsePositive = structuredClone(incompletePack);
  (falsePositive as { readyForDraft: boolean }).readyForDraft = true;
  assert.throws(
    () => assertResearchPack(falsePositive),
    /deterministic eligibility result false/,
  );
});

test("R12: invalid source and claim references are rejected at runtime", async () => {
  const { candidate, fixture } = completeFixture();
  const pack = await research(candidate, fixture);

  const invalidSourceReference = structuredClone(pack);
  invalidSourceReference.claims[0].evidence[0].sourceId = "missing-source";
  assert.throws(
    () => assertResearchPack(invalidSourceReference),
    /references unknown source missing-source/,
  );

  const invalidClaimReference = structuredClone(pack);
  invalidClaimReference.evidenceLeadResolutions[0].researchClaimIds = [
    "missing-claim",
  ];
  assert.throws(
    () => assertResearchPack(invalidClaimReference),
    /references unknown claim missing-claim/,
  );

  const missingLeadResolution = structuredClone(pack);
  missingLeadResolution.evidenceLeadResolutions = [];
  assert.throws(
    () => assertResearchPack(missingLeadResolution),
    /Every Evidence Lead must have exactly one resolution/,
  );
});
