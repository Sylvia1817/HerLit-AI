import { OrchestrationError } from "./errors.ts";

export const EDITORIAL_TIME_ZONE = "Asia/Shanghai" as const;

export function getEditorialDate(
  instant: Date = new Date(),
  timeZone: string = EDITORIAL_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isValidEditorialDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertEditorialDate(value: string): void {
  if (!isValidEditorialDate(value)) {
    throw new OrchestrationError({
      stage: "selection",
      code: "INVALID_EDITORIAL_DATE",
      message: "date must be a real calendar date in YYYY-MM-DD format",
      retryable: false,
      details: { timeZone: EDITORIAL_TIME_ZONE },
    }, 422);
  }
}
