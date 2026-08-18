import type { DailyEditorialPackage } from "../../types/editorial.ts";
import {
  assertDailyEditorialPackage,
  isEditorialReviewStale,
  reviewedInputBindingsMatch,
} from "../editorial-production/index.ts";
import type { EditorialExportOptions, HumanApproval, HumanReviewState } from "./types.ts";

export function approveEditorialPackage(
  packageId: string,
  editorialPackage: DailyEditorialPackage,
  now = new Date(),
): HumanApproval {
  assertDailyEditorialPackage(editorialPackage);
  if (editorialPackage.status !== "draft") throw new Error("Domain package status must remain draft");
  if (
    isEditorialReviewStale(editorialPackage.review.reviewedInputBinding, {
      context: editorialPackage.verifiedContext,
      valueModules: editorialPackage.valueModules,
      draft: editorialPackage.draft,
    }) ||
    editorialPackage.review.recommendation !== "ready_for_human_review"
  ) {
    throw new Error("A current ready_for_human_review result is required before approval");
  }
  return {
    status: "approved",
    packageId,
    reviewBinding: structuredClone(editorialPackage.review.reviewedInputBinding),
    approvedAt: now.toISOString(),
    approvedBy: "editor",
  };
}

export function assertApprovalCurrent(
  packageId: string,
  editorialPackage: DailyEditorialPackage,
  approval: HumanApproval | undefined,
): asserts approval is HumanApproval {
  assertDailyEditorialPackage(editorialPackage);
  if (!approval || approval.status !== "approved") {
    throw new Error("Publish-ready export requires explicit human approval");
  }
  if (approval.packageId !== packageId) throw new Error("Human approval belongs to a different package");
  if (!reviewedInputBindingsMatch(approval.reviewBinding, editorialPackage.review.reviewedInputBinding)) {
    throw new Error("Human approval is stale for the current review revision");
  }
  if (isEditorialReviewStale(editorialPackage.review.reviewedInputBinding, {
    context: editorialPackage.verifiedContext,
    valueModules: editorialPackage.valueModules,
    draft: editorialPackage.draft,
  })) {
    throw new Error("Current Editorial Review is stale");
  }
}

function assertExportAllowed(
  packageId: string,
  editorialPackage: DailyEditorialPackage,
  state: HumanReviewState,
  publishReady: boolean,
): void {
  if (publishReady) {
    assertApprovalCurrent(packageId, editorialPackage, state.status === "approved" ? state : undefined);
  } else {
    assertDailyEditorialPackage(editorialPackage);
  }
}

export function exportEditorialMarkdown(
  packageId: string,
  editorialPackage: DailyEditorialPackage,
  state: HumanReviewState,
  options: EditorialExportOptions,
): string {
  assertExportAllowed(packageId, editorialPackage, state, options.publishReady);
  const title = editorialPackage.draft.titles[options.preferredTitleIndex] ?? editorialPackage.draft.titles[0];
  const prefix = options.publishReady ? "" : "# DRAFT — 待人工审核\n\n";
  const sources = editorialPackage.researchAudit.sources
    .map((source) => `- [${source.title}](${source.url}) · ${source.sourceType}`)
    .join("\n");
  const cards = editorialPackage.draft.cards
    .map((card) => `${card.order}. **${card.title}** — ${card.copy}\n   - 视觉：${card.visualDirection}`)
    .join("\n");
  return `${prefix}# ${title.text}\n\n- 日期：${editorialPackage.date}\n- TODAY'S PICK：${editorialPackage.draft.writer.name}\n- Why Her Today：${editorialPackage.verifiedContext.whyHerToday.shortReason}\n- 状态：${editorialPackage.status}（Human: ${state.status}）\n\n${editorialPackage.draft.body}\n\n${editorialPackage.draft.hashtags.join(" ")}\n\n## Cards\n\n${cards}\n\n## Sources\n\n${sources}\n\n## Verification Notes\n\n- Verified claims：${editorialPackage.researchAudit.verification.passedClaimIds.join(", ")}\n- Needs review：${editorialPackage.researchAudit.verification.needsReviewClaimIds.join(", ") || "无"}\n- Rejected：${editorialPackage.researchAudit.verification.rejectedClaimIds.join(", ") || "无"}\n`;
}

export function exportEditorialJson(
  packageId: string,
  editorialPackage: DailyEditorialPackage,
  state: HumanReviewState,
  options: EditorialExportOptions,
): string {
  assertExportAllowed(packageId, editorialPackage, state, options.publishReady);
  return JSON.stringify({
    exportStatus: options.publishReady ? "APPROVED" : "DRAFT",
    humanReview: state,
    preferredTitleIndex: options.preferredTitleIndex,
    editorialPackage,
  }, null, 2);
}
