import type { EditorialHistoryEntry } from "./contracts.ts";
import { RECENT_REPEAT_PENALTY_BANDS } from "./constants.ts";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`Invalid date: ${value}`);
  }

  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`Invalid date: ${value}`);
  }

  const normalized = new Date(timestamp).toISOString().slice(0, 10);
  if (normalized !== value) {
    throw new TypeError(`Invalid date: ${value}`);
  }

  return timestamp;
}

export function daysBetweenDateOnly(later: string, earlier: string): number {
  return Math.floor(
    (parseDateOnly(later) - parseDateOnly(earlier)) / MILLISECONDS_PER_DAY,
  );
}

export function calculateRecentRepeatPenalty(
  writerId: string,
  selectionDate: string,
  entries: readonly EditorialHistoryEntry[],
): number {
  let penalty = 0;

  for (const entry of entries) {
    if (entry.writerId !== writerId) continue;

    const daysAgo = daysBetweenDateOnly(selectionDate, entry.publishedDate);
    if (daysAgo < 0) continue;

    const band = RECENT_REPEAT_PENALTY_BANDS.find(
      (candidateBand) => daysAgo <= candidateBand.maxDaysAgo,
    );
    if (band) penalty = Math.max(penalty, band.penalty);
  }

  return penalty;
}
