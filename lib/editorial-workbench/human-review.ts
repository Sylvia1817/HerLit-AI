import type { DailyEditorialPackage } from "../../types/editorial.ts";
import type { EditorialExportOptions, HumanReviewState } from "./types.ts";

export function approveEditorialPackage(
  editorialPackage: DailyEditorialPackage,
  reviewIsStale: boolean,
  now = new Date(),
): HumanReviewState {
  if (editorialPackage.status !== "draft") throw new Error("Domain package status must remain draft");
  if (reviewIsStale || editorialPackage.review.recommendation !== "ready_for_human_review") {
    throw new Error("A current ready_for_human_review result is required before approval");
  }
  return { status: "approved", approvedAt: now.toISOString(), approvedBy: "editor" };
}

function assertExportAllowed(state: HumanReviewState, publishReady: boolean): void {
  if (publishReady && state.status !== "approved") {
    throw new Error("Publish-ready export requires explicit human approval");
  }
}

export function exportEditorialMarkdown(
  editorialPackage: DailyEditorialPackage,
  state: HumanReviewState,
  options: EditorialExportOptions,
): string {
  assertExportAllowed(state, options.publishReady);
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
  editorialPackage: DailyEditorialPackage,
  state: HumanReviewState,
  options: EditorialExportOptions,
): string {
  assertExportAllowed(state, options.publishReady);
  return JSON.stringify({
    exportStatus: options.publishReady ? "APPROVED" : "DRAFT",
    humanReview: state,
    preferredTitleIndex: options.preferredTitleIndex,
    editorialPackage,
  }, null, 2);
}
