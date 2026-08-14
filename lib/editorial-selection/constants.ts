import type { CandidateSignalKey } from "./contracts.ts";

export const TIER_ORDER = ["A", "B", "C"] as const;

export const CANDIDATE_SCORE_WEIGHTS: Readonly<
  Record<CandidateSignalKey, number>
> = Object.freeze({
  dateRelevance: 0.25,
  storyTension: 0.15,
  readerValue: 0.2,
  growthPotential: 0.15,
  herlitDistinctiveness: 0.15,
  recognition: 0.05,
  sourceAvailability: 0.05,
});

export const CANDIDATE_QUALIFICATION = Object.freeze({
  minQualifiedCandidates: 3,
  minDateRelevance: 55,
  minSourceAvailability: 45,
  minStoryTension: 45,
  minReaderValue: 50,
  minWeightedBase: 60,
  minWeightedTotal: 45,
});

export const RECENT_REPEAT_PENALTY_BANDS = Object.freeze([
  { maxDaysAgo: 7, penalty: 30 },
  { maxDaysAgo: 30, penalty: 15 },
  { maxDaysAgo: 90, penalty: 5 },
] as const);

export const EDITORIAL_HISTORY_WINDOW_DAYS = 90;
