import type {
  DailyEditorialPackage,
  EditorialSelectionResult,
  ResearchPack,
} from "../../types/editorial.ts";
import { assertSelectionResult } from "../editorial-selection/engine.ts";
import { assertResearchPack } from "../research-verification/engine.ts";
import {
  assertVerifiedEditorialContext,
  buildVerifiedEditorialContext,
  verifiedContextsMatch,
} from "./context.ts";
import { assertGroundedDraft, HERLIT_BRAND_RULES } from "./draft-engine.ts";
import { assertEditorialReviewResult } from "./review-engine.ts";
import { assertValueModules } from "./value-engine.ts";

export function assertDailyEditorialPackage(
  result: DailyEditorialPackage,
): asserts result is DailyEditorialPackage {
  if (result.status !== "draft" || result.draft.status !== "draft" || result.review.status !== "draft") {
    throw new Error("DailyEditorialPackage and all automated outputs must remain draft");
  }
  assertSelectionResult(result.selection);
  assertResearchPack(result.researchAudit);
  assertVerifiedEditorialContext(result.verifiedContext);
  if (
    result.date !== result.selection.date ||
    result.researchAudit.candidateId !== result.selection.selectedCandidate.id ||
    result.verifiedContext.candidateId !== result.selection.selectedCandidate.id
  ) {
    throw new Error("DailyEditorialPackage stage identities do not match");
  }
  const rebuiltContext = buildVerifiedEditorialContext(
    result.researchAudit,
    result.date,
  );
  if (!verifiedContextsMatch(result.verifiedContext, rebuiltContext)) {
    throw new Error("VerifiedEditorialContext must be rebuilt from ResearchPack");
  }
  assertValueModules(result.valueModules, result.verifiedContext);
  assertGroundedDraft(result.draft, {
    context: result.verifiedContext,
    valueModules: result.valueModules,
    brandRules: HERLIT_BRAND_RULES,
  });
  assertEditorialReviewResult(result.review);
}

export function assembleDailyEditorialPackage(
  selection: EditorialSelectionResult,
  researchAudit: ResearchPack,
  verifiedContext: DailyEditorialPackage["verifiedContext"],
  valueModules: DailyEditorialPackage["valueModules"],
  draft: DailyEditorialPackage["draft"],
  review: DailyEditorialPackage["review"],
): DailyEditorialPackage {
  const result: DailyEditorialPackage = {
    date: selection.date,
    selection: structuredClone(selection),
    researchAudit: structuredClone(researchAudit),
    verifiedContext: structuredClone(verifiedContext),
    valueModules: structuredClone(valueModules),
    draft: structuredClone(draft),
    review: structuredClone(review),
    status: "draft",
  };
  assertDailyEditorialPackage(result);
  return result;
}
