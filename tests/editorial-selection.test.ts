import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateSignals,
  DateRelevanceTier,
  RelationType,
} from "../types/editorial.ts";
import {
  CANDIDATE_SCORE_WEIGHTS,
  DailyEditorialSelectionEngine,
  MockEditorialCandidateProvider,
  MockEditorialHistoryProvider,
  assertSelectionResult,
  calculateCandidateScore,
} from "../lib/editorial-selection/index.ts";
import type {
  EditorialHistoryEntry,
  MockCandidateFixture,
  MockCandidateFixtureSet,
} from "../lib/editorial-selection/index.ts";

const BASE_SIGNALS: CandidateSignals = {
  dateRelevance: 80,
  sourceAvailability: 75,
  recognition: 60,
  storyTension: 75,
  readerValue: 78,
  growthPotential: 72,
  herlitDistinctiveness: 76,
};

function candidateSignals(
  overrides: Partial<CandidateSignals> = {},
): CandidateSignals {
  return { ...BASE_SIGNALS, ...overrides };
}

function relationForTier(tier: DateRelevanceTier): RelationType {
  if (tier === "B") return "month_link";
  if (tier === "C") return "seasonal_editorial_link";
  return "birth";
}

function candidateFixture(
  id: string,
  tier: DateRelevanceTier,
  options: {
    signals?: Partial<CandidateSignals>;
    relationType?: RelationType;
    relationDate?: string;
    isEditorialLink?: boolean;
    editorialReason?: string;
  } = {},
): MockCandidateFixture {
  return {
    id,
    writer: {
      id: `writer-${id}`,
      name: `作家 ${id}`,
      originalName: `Writer ${id}`,
      knownFor: [`作品 ${id}`],
    },
    proposedWhyHerToday: {
      relationType: options.relationType ?? relationForTier(tier),
      relationDate: options.relationDate,
      tier,
      isEditorialLink: options.isEditorialLink ?? tier === "C",
      shortReason: `这是 ${tier} 级日期关系`,
      editorExplanation: `待 Research 核验的 ${tier} 级选题依据`,
      evidenceLeads: [
        {
          id: `lead-${id}`,
          description: `核验作家 ${id} 的日期关系`,
          expectedSourceType: "institution",
          searchHint: `作家 ${id} 日期关系`,
        },
      ],
    },
    signals: candidateSignals(options.signals),
    editorialReason:
      options.editorialReason ?? `作家 ${id} 提供了具体且可收藏的编辑角度`,
    risks: ["所有日期关系仍需进入 Research"],
  };
}

function createEngine(
  fixtures: MockCandidateFixtureSet,
  history: readonly EditorialHistoryEntry[] = [],
) {
  const candidateProvider = new MockEditorialCandidateProvider(fixtures);
  const historyProvider = new MockEditorialHistoryProvider(history);
  return {
    candidateProvider,
    engine: new DailyEditorialSelectionEngine(
      candidateProvider,
      historyProvider,
    ),
  };
}

test("deterministic scoring uses centralized weights and program deductions", () => {
  const weightTotal = Object.values(CANDIDATE_SCORE_WEIGHTS).reduce(
    (total, weight) => total + weight,
    0,
  );
  assert.ok(Math.abs(weightTotal - 1) < 1e-12);

  const score = calculateCandidateScore(
    candidateSignals({
      dateRelevance: 80,
      sourceAvailability: 80,
      recognition: 80,
      storyTension: 80,
      readerValue: 80,
      growthPotential: 80,
      herlitDistinctiveness: 80,
    }),
    15,
  );

  assert.deepEqual(score, {
    weightedBase: 80,
    recentRepeatPenalty: 15,
    weightedTotal: 65,
  });
});

test("Case A: a strong same-day birthday candidate wins after comparison", async () => {
  const date = "2026-01-25";
  const { candidateProvider, engine } = createEngine({
    [date]: {
      A: [
        candidateFixture("famous-birthday", "A", {
          relationDate: date,
          signals: {
            dateRelevance: 98,
            sourceAvailability: 92,
            recognition: 95,
            storyTension: 88,
            readerValue: 90,
            growthPotential: 86,
            herlitDistinctiveness: 84,
          },
        }),
        candidateFixture("publication", "A", {
          relationType: "publication",
        }),
        candidateFixture("life-event", "A", {
          relationType: "life_event",
        }),
      ],
    },
  });

  const result = await engine.select({ date });

  assert.equal(result.selectedCandidate.id, "famous-birthday");
  assert.deepEqual(candidateProvider.calls, [{ date, tier: "A" }]);
  assert.equal(result.candidateShortlist.length, 3);
  assert.equal(result.selectedCandidate.provenance.providerMode, "mock");
  assert.deepEqual(
    result.candidateShortlist.map(({ rank }) => rank),
    [1, 2, 3],
  );
});

test("Case B: death, publication and award candidates work without a birthday", async () => {
  const date = "2026-02-11";
  const { candidateProvider, engine } = createEngine({
    [date]: {
      A: [
        candidateFixture("death", "A", { relationType: "death" }),
        candidateFixture("publication", "A", {
          relationType: "publication",
        }),
        candidateFixture("award", "A", { relationType: "award" }),
      ],
    },
  });

  const result = await engine.select({ date });

  assert.deepEqual(candidateProvider.calls, [{ date, tier: "A" }]);
  assert.deepEqual(
    new Set(
      result.candidateShortlist.map(
        ({ proposedWhyHerToday }) => proposedWhyHerToday.relationType,
      ),
    ),
    new Set(["death", "publication", "award"]),
  );
});

test("Case C: five weak Tier A candidates still trigger Tier B fallback", async () => {
  const date = "2026-03-18";
  const weakSignals: Partial<CandidateSignals> = {
    dateRelevance: 38,
    sourceAvailability: 30,
    storyTension: 32,
    readerValue: 35,
    growthPotential: 38,
    herlitDistinctiveness: 40,
  };
  const { candidateProvider, engine } = createEngine({
    [date]: {
      A: Array.from({ length: 5 }, (_, index) =>
        candidateFixture(`weak-a-${index + 1}`, "A", {
          signals: weakSignals,
        }),
      ),
      B: [
        candidateFixture("month-1", "B", {
          signals: { readerValue: 90, herlitDistinctiveness: 90 },
        }),
        candidateFixture("month-2", "B"),
        candidateFixture("month-3", "B"),
      ],
    },
  });

  const result = await engine.select({ date });

  assert.deepEqual(candidateProvider.calls, [
    { date, tier: "A" },
    { date, tier: "B" },
  ]);
  assert.equal(result.selectedCandidate.proposedWhyHerToday.tier, "B");
  assert.ok(result.candidateShortlist.length >= 3);
});

test("Case D: Tier C requires an explicit editorial link", async () => {
  const date = "2026-04-09";
  const { candidateProvider, engine } = createEngine({
    [date]: {
      C: [
        candidateFixture("editorial-1", "C"),
        candidateFixture("editorial-2", "C"),
        candidateFixture("editorial-3", "C"),
      ],
    },
  });

  const result = await engine.select({ date });

  assert.deepEqual(candidateProvider.calls, [
    { date, tier: "A" },
    { date, tier: "B" },
    { date, tier: "C" },
  ]);
  assert.ok(
    result.candidateShortlist.every(
      ({ proposedWhyHerToday }) =>
        proposedWhyHerToday.tier === "C" &&
        proposedWhyHerToday.isEditorialLink &&
        proposedWhyHerToday.evidenceLeads.length > 0,
    ),
  );

  const invalidEngine = createEngine({
    [date]: {
      C: [
        candidateFixture("invalid-editorial", "C", {
          isEditorialLink: false,
        }),
        candidateFixture("valid-editorial-2", "C"),
        candidateFixture("valid-editorial-3", "C"),
      ],
    },
  }).engine;

  await assert.rejects(
    invalidEngine.select({ date }),
    /Tier C candidate invalid-editorial must be an editorial link/,
  );
});

test("Case F: a writer repeated 14 days ago receives a medium penalty", async () => {
  const date = "2026-08-14";
  const repeated = candidateFixture("repeated-famous", "A", {
    signals: {
      dateRelevance: 92,
      recognition: 96,
      storyTension: 85,
      readerValue: 86,
      growthPotential: 86,
      herlitDistinctiveness: 84,
    },
  });
  const { engine } = createEngine(
    {
      [date]: {
        A: [
          repeated,
          candidateFixture("fresh-writer", "A", {
            signals: {
              dateRelevance: 88,
              storyTension: 84,
              readerValue: 88,
              herlitDistinctiveness: 90,
            },
          }),
          candidateFixture("third-writer", "A"),
        ],
      },
    },
    [
      {
        writerId: repeated.writer.id,
        publishedDate: "2026-08-01",
        topicKeys: ["modernism"],
      },
    ],
  );

  const result = await engine.select({ date });
  const repeatedCandidate = result.candidateShortlist.find(
    ({ id }) => id === "repeated-famous",
  );

  assert.equal(repeatedCandidate?.score.recentRepeatPenalty, 15);
  assert.equal(result.selectedCandidate.id, "fresh-writer");
  assert.match(
    result.selectionDecision.whyNotOthers.find(
      ({ candidateId }) => candidateId === "repeated-famous",
    )?.reason ?? "",
    /近期重复扣分 15/,
  );
});

test("Case G: a less famous but stronger HerLit story can outrank fame", async () => {
  const date = "2026-06-06";
  const { engine } = createEngine({
    [date]: {
      A: [
        candidateFixture("famous", "A", {
          signals: {
            dateRelevance: 80,
            sourceAvailability: 80,
            recognition: 95,
            storyTension: 50,
            readerValue: 55,
            growthPotential: 60,
            herlitDistinctiveness: 60,
          },
        }),
        candidateFixture("distinctive", "A", {
          signals: {
            dateRelevance: 80,
            sourceAvailability: 75,
            recognition: 45,
            storyTension: 90,
            readerValue: 92,
            growthPotential: 80,
            herlitDistinctiveness: 92,
          },
        }),
        candidateFixture("balanced", "A"),
      ],
    },
  });

  const result = await engine.select({ date });

  assert.equal(result.selectedCandidate.id, "distinctive");
  assert.ok(
    result.selectedCandidate.signals.recognition <
      result.candidateShortlist.find(({ id }) => id === "famous")!.signals
        .recognition,
  );
});

test("runtime invariant rejects a selectedCandidate/decision mismatch", async () => {
  const date = "2026-07-07";
  const { engine } = createEngine({
    [date]: {
      A: [
        candidateFixture("one", "A"),
        candidateFixture("two", "A"),
        candidateFixture("three", "A"),
      ],
    },
  });
  const result = await engine.select({ date });

  assert.throws(
    () =>
      assertSelectionResult({
        ...result,
        selectedCandidate: result.candidateShortlist[1],
      }),
    /selectedCandidateId does not match selectedCandidate.id/,
  );
});
