import { createHash } from "node:crypto";

import type { ReviewedInputBinding } from "../../types/editorial.ts";
import type { EditorialReviewInput } from "./contracts.ts";

export const REVIEWED_INPUT_REVISION = "editorial-review-input/v1" as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "undefined" ? null : canonicalize(item),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => typeof item !== "undefined")
        .sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        )
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function buildReviewedInputBinding(
  input: EditorialReviewInput,
): ReviewedInputBinding {
  const canonicalInput = JSON.stringify(
    canonicalize({
      context: input.context,
      valueModules: input.valueModules,
      draft: input.draft,
    }),
  );
  return {
    revision: REVIEWED_INPUT_REVISION,
    algorithm: "sha256",
    fingerprint: createHash("sha256").update(canonicalInput).digest("hex"),
  };
}

export function reviewedInputBindingsMatch(
  actual: ReviewedInputBinding,
  expected: ReviewedInputBinding,
): boolean {
  return (
    actual.revision === expected.revision &&
    actual.algorithm === expected.algorithm &&
    actual.fingerprint === expected.fingerprint
  );
}

export function isEditorialReviewStale(
  binding: ReviewedInputBinding,
  input: EditorialReviewInput,
): boolean {
  return !reviewedInputBindingsMatch(binding, buildReviewedInputBinding(input));
}
