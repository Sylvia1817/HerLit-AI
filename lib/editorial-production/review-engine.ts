import type {
  EditorialReviewResult,
  GrowthNotes,
} from "../../types/editorial.ts";
import type {
  EditorialReviewInput,
  EditorialReviewProposal,
  EditorialReviewProvider,
} from "./contracts.ts";
import { assertVerifiedEditorialContext } from "./context.ts";
import { assertGroundedDraft, HERLIT_BRAND_RULES } from "./draft-engine.ts";
import { assertValueModules } from "./value-engine.ts";
import {
  buildReviewedInputBinding,
  REVIEWED_INPUT_REVISION,
  reviewedInputBindingsMatch,
} from "./review-binding.ts";

const EMPTY_GROWTH_PHRASES = [
  "内容很优质",
  "内容优质",
  "HerLit 有价值",
  "HerLit很有价值",
];

function assertGrowthNotes(notes: GrowthNotes): void {
  for (const [key, value] of Object.entries(notes)) {
    if (!value.trim() || value.trim().length < 10) {
      throw new Error(`GrowthNotes.${key} must give a concrete editorial reason`);
    }
  }
  if (EMPTY_GROWTH_PHRASES.some((phrase) => notes.followReason.includes(phrase))) {
    throw new Error("GrowthNotes.followReason must explain why readers will follow HerLit");
  }
}

function assertReviewProposalBoundary(proposal: EditorialReviewProposal): void {
  if (proposal.status !== "draft") {
    throw new Error("Automated review status must remain draft");
  }
  const forbiddenKeys = [
    "context",
    "researchPack",
    "claims",
    "sources",
    "valueModules",
    "draft",
    "titles",
    "blocks",
    "cards",
    "reviewedInputBinding",
    "fingerprint",
    "revision",
  ];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(proposal, key)) {
      throw new Error(`Editorial review cannot output or change ${key}`);
    }
  }
}

export function assertEditorialReviewResult(
  result: EditorialReviewResult,
  input?: EditorialReviewInput,
): asserts result is EditorialReviewResult {
  if (result.status !== "draft") {
    throw new Error("Automated review status must remain draft");
  }
  if (!result.provider.id || !["mock", "live"].includes(result.provider.mode)) {
    throw new Error("Editorial review must preserve provider provenance");
  }
  const binding = result.reviewedInputBinding;
  if (
    !binding ||
    binding.revision !== REVIEWED_INPUT_REVISION ||
    binding.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(binding.fingerprint)
  ) {
    throw new Error("Editorial review has an invalid reviewed-input binding");
  }
  if (
    input &&
    !reviewedInputBindingsMatch(
      binding,
      buildReviewedInputBinding(input),
    )
  ) {
    throw new Error("Editorial review is bound to different reviewed inputs");
  }
  if (
    !["ready_for_human_review", "needs_revision"].includes(
      result.recommendation,
    )
  ) {
    throw new Error("Editorial review has an invalid recommendation");
  }
  assertGrowthNotes(result.growthNotes);
  const issueCodes = result.issues.map(({ code }) => code);
  if (new Set(issueCodes).size !== issueCodes.length) {
    throw new Error("Editorial issue codes must be unique");
  }
  for (const issue of result.issues) {
    if (
      !issue.code.trim() ||
      !issue.message.trim() ||
      !["warning", "error"].includes(issue.severity)
    ) {
      throw new Error("Editorial issues need a code and message");
    }
  }
  if (
    result.recommendation === "ready_for_human_review" &&
    result.issues.some(({ severity }) => severity === "error")
  ) {
    throw new Error("A draft with review errors needs revision");
  }
}

export class EditorialReviewEngine {
  private readonly provider: EditorialReviewProvider;

  constructor(provider: EditorialReviewProvider) {
    this.provider = provider;
  }

  async create(input: EditorialReviewInput): Promise<EditorialReviewResult> {
    assertVerifiedEditorialContext(input.context);
    assertValueModules(input.valueModules, input.context);
    assertGroundedDraft(input.draft, {
      context: input.context,
      valueModules: input.valueModules,
      brandRules: HERLIT_BRAND_RULES,
    });
    const proposal = structuredClone(
      await this.provider.review(structuredClone(input)),
    );
    assertReviewProposalBoundary(proposal);

    const result: EditorialReviewResult = {
      provider: { id: this.provider.id, mode: this.provider.mode },
      growthNotes: proposal.growthNotes,
      issues: proposal.issues,
      recommendation: proposal.recommendation,
      reviewedInputBinding: buildReviewedInputBinding(input),
      status: "draft",
    };
    assertEditorialReviewResult(result, input);
    return result;
  }
}
