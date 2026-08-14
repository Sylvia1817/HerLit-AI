import type {
  Candidate,
  CandidateScore,
  CandidateSignals,
} from "../../types/editorial.ts";
import {
  CANDIDATE_QUALIFICATION,
  CANDIDATE_SCORE_WEIGHTS,
} from "./constants.ts";

const SCORE_PRECISION = 100;

function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * SCORE_PRECISION) / SCORE_PRECISION;
}

function assertScoreValue(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${label} must be a finite number between 0 and 100`);
  }
}

export function calculateCandidateScore(
  signals: CandidateSignals,
  recentRepeatPenalty: number,
): CandidateScore {
  const signalEntries = Object.entries(CANDIDATE_SCORE_WEIGHTS) as Array<
    [keyof CandidateSignals, number]
  >;

  for (const [key] of signalEntries) {
    assertScoreValue(key, signals[key]);
  }
  assertScoreValue("recentRepeatPenalty", recentRepeatPenalty);

  const weightedBase = roundScore(
    signalEntries.reduce(
      (total, [key, weight]) => total + signals[key] * weight,
      0,
    ),
  );
  const weightedTotal = roundScore(
    Math.max(0, weightedBase - recentRepeatPenalty),
  );

  return {
    weightedBase,
    recentRepeatPenalty,
    weightedTotal,
  };
}

export function isQualifiedCandidate(candidate: Candidate): boolean {
  const { signals, score } = candidate;

  return (
    signals.dateRelevance >= CANDIDATE_QUALIFICATION.minDateRelevance &&
    signals.sourceAvailability >=
      CANDIDATE_QUALIFICATION.minSourceAvailability &&
    signals.storyTension >= CANDIDATE_QUALIFICATION.minStoryTension &&
    signals.readerValue >= CANDIDATE_QUALIFICATION.minReaderValue &&
    score.weightedBase >= CANDIDATE_QUALIFICATION.minWeightedBase &&
    score.weightedTotal >= CANDIDATE_QUALIFICATION.minWeightedTotal
  );
}

export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates]
    .sort(
      (left, right) =>
        right.score.weightedTotal - left.score.weightedTotal ||
        right.signals.dateRelevance - left.signals.dateRelevance ||
        right.signals.herlitDistinctiveness -
          left.signals.herlitDistinctiveness ||
        left.id.localeCompare(right.id),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
