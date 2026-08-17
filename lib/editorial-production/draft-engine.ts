import type {
  CardPlan,
  CardPlanCollection,
  DraftBlock,
  DraftTitle,
  DraftTitleCollection,
  GroundedDraft,
  WriterBrandRules,
  WriterInput,
} from "../../types/editorial.ts";
import type {
  EditorialWriterProvider,
  WriterProposal,
} from "./contracts.ts";
import { assertVerifiedEditorialContext } from "./context.ts";
import {
  assertGroundedClaimIds,
  assertQuoteGrounding,
  verifiedClaimMap,
} from "./grounding.ts";
import { assertValueModules } from "./value-engine.ts";

export const HERLIT_BRAND_RULES: WriterBrandRules = Object.freeze({
  requiredHashtags: ["#HerLit", "#girltalk", "#她文日历"] as const,
  tone: "specific_restrained_literary",
  autoApprovalAllowed: false,
});

const DRAFT_BLOCK_ROLES = new Set<DraftBlock["role"]>([
  "hook",
  "why_today",
  "story",
  "meaning",
  "value",
  "interaction",
]);

const CARD_ROLES = new Set<CardPlan["role"]>([
  "cover",
  "why_her_today",
  "story",
  "work",
  "saveable_knowledge",
  "reading_path",
  "interaction",
]);

function toTitles(titles: DraftTitle[]): DraftTitleCollection {
  if (titles.length < 3 || titles.length > 5) {
    throw new Error("Grounded draft must contain 3–5 titles");
  }
  return titles as DraftTitleCollection;
}

function toCards(cards: CardPlan[]): CardPlanCollection {
  if (cards.length < 3 || cards.length > 6) {
    throw new Error("Grounded draft must contain 3–6 cards");
  }
  return cards as CardPlanCollection;
}

export function renderDraftBody(blocks: readonly DraftBlock[]): string {
  return blocks.map(({ text }) => text.trim()).join("\n\n");
}

function assertWriterInput(input: WriterInput): void {
  assertVerifiedEditorialContext(input.context);
  assertValueModules(input.valueModules, input.context);
  if (
    input.brandRules.autoApprovalAllowed !== false ||
    input.brandRules.tone !== "specific_restrained_literary" ||
    JSON.stringify(input.brandRules.requiredHashtags) !==
      JSON.stringify(HERLIT_BRAND_RULES.requiredHashtags)
  ) {
    throw new Error("WriterInput must preserve HerLit brand safety rules");
  }
}

export function assertGroundedDraft(
  draft: GroundedDraft,
  input: WriterInput,
): asserts draft is GroundedDraft {
  assertWriterInput(input);
  const { context, valueModules } = input;
  const claimsById = verifiedClaimMap(context.claims);

  if (draft.status !== "draft") {
    throw new Error("Automated Writer output status must be draft");
  }
  if (draft.date !== context.date || draft.writer.id !== context.writer.id) {
    throw new Error("Grounded draft does not match Writer context");
  }
  if (!draft.provider.id || !["mock", "live"].includes(draft.provider.mode)) {
    throw new Error("Grounded draft must include provider provenance");
  }
  if (!draft.readerHook.trim() || !draft.editorialAngle.trim()) {
    throw new Error("Grounded draft needs readerHook and editorialAngle");
  }

  if (draft.titles.length < 3 || draft.titles.length > 5) {
    throw new Error("Grounded draft must contain 3–5 titles");
  }
  for (const [index, title] of draft.titles.entries()) {
    if (!title.text.trim() || !title.angle.trim()) {
      throw new Error(`Title ${index + 1} must contain text and angle`);
    }
    if (title.evidenceClaimIds.length === 0) {
      throw new Error(`Title ${index + 1} must cite verified evidence`);
    }
    assertGroundedClaimIds(
      `Title ${index + 1}`,
      title.evidenceClaimIds,
      claimsById,
    );
    assertQuoteGrounding(
      `Title ${index + 1}`,
      title.text,
      title.evidenceClaimIds,
      title.quoteAttributions,
      claimsById,
    );
  }

  const blockIds = draft.blocks.map(({ id }) => id);
  if (new Set(blockIds).size !== blockIds.length) {
    throw new Error("DraftBlock IDs must be unique");
  }
  if (draft.blocks.length === 0) {
    throw new Error("Grounded draft must contain DraftBlocks");
  }
  const moduleClaimIds = new Set(
    valueModules.flatMap(({ evidenceClaimIds }) => evidenceClaimIds),
  );
  for (const block of draft.blocks) {
    if (!DRAFT_BLOCK_ROLES.has(block.role) || !block.text.trim()) {
      throw new Error(`DraftBlock ${block.id} is invalid`);
    }
    assertGroundedClaimIds(
      `DraftBlock ${block.id}`,
      block.evidenceClaimIds,
      claimsById,
    );
    if (
      block.role !== "hook" &&
      block.role !== "interaction" &&
      block.evidenceClaimIds.length === 0
    ) {
      throw new Error(`Factual DraftBlock ${block.id} must cite evidence`);
    }
    if (
      block.role === "why_today" &&
      !context.whyHerToday.evidenceClaimIds.every((claimId) =>
        block.evidenceClaimIds.includes(claimId),
      )
    ) {
      throw new Error("why_today block must cite Why Her Today evidence");
    }
    if (
      block.role === "value" &&
      block.evidenceClaimIds.some((claimId) => !moduleClaimIds.has(claimId))
    ) {
      throw new Error("value block may cite only approved ValueModule claims");
    }
    assertQuoteGrounding(
      `DraftBlock ${block.id}`,
      block.text,
      block.evidenceClaimIds,
      block.quoteAttributions,
      claimsById,
    );
  }
  if (!draft.blocks.some(({ role }) => role === "why_today")) {
    throw new Error("Grounded draft must contain a why_today block");
  }
  if (draft.body !== renderDraftBody(draft.blocks)) {
    throw new Error("Draft body must be rendered deterministically from blocks");
  }

  if (new Set(draft.hashtags).size !== draft.hashtags.length) {
    throw new Error("Draft hashtags must be unique");
  }
  for (const hashtag of HERLIT_BRAND_RULES.requiredHashtags) {
    if (!draft.hashtags.includes(hashtag)) {
      throw new Error(`Draft is missing required hashtag ${hashtag}`);
    }
  }

  if (draft.cards.length < 3 || draft.cards.length > 6) {
    throw new Error("Grounded draft must contain 3–6 cards");
  }
  draft.cards.forEach((card, index) => {
    if (!CARD_ROLES.has(card.role) || card.order !== index + 1) {
      throw new Error(`Card ${index + 1} has invalid role or order`);
    }
    if (!card.title.trim() || !card.copy.trim()) {
      throw new Error(`Card ${index + 1} needs title and copy`);
    }
    assertGroundedClaimIds(
      `Card ${index + 1}`,
      card.evidenceClaimIds,
      claimsById,
    );
    if (
      card.role !== "cover" &&
      card.role !== "interaction" &&
      card.evidenceClaimIds.length === 0
    ) {
      throw new Error(`Factual card ${index + 1} must cite evidence`);
    }
    if (
      card.role === "why_her_today" &&
      !context.whyHerToday.evidenceClaimIds.every((claimId) =>
        card.evidenceClaimIds.includes(claimId),
      )
    ) {
      throw new Error("Why Her Today card must cite date evidence");
    }
    assertQuoteGrounding(
      `Card ${index + 1}`,
      `${card.title}\n${card.copy}`,
      card.evidenceClaimIds,
      card.quoteAttributions,
      claimsById,
    );
  });
  if (!draft.cards.some(({ role }) => role === "why_her_today")) {
    throw new Error("Grounded cards must include a Why Her Today card");
  }
}

function assertWriterProposalBoundary(proposal: WriterProposal): void {
  if (proposal.status !== "draft") {
    throw new Error("Writer proposal cannot output approved status");
  }
  const forbiddenKeys = [
    "body",
    "claims",
    "sources",
    "researchPack",
    "verifiedClaims",
    "growthNotes",
    "review",
  ];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(proposal, key)) {
      throw new Error(`Writer proposal cannot output ${key}`);
    }
  }
}

export class EditorialWriterEngine {
  private readonly provider: EditorialWriterProvider;

  constructor(provider: EditorialWriterProvider) {
    this.provider = provider;
  }

  async create(input: WriterInput): Promise<GroundedDraft> {
    assertWriterInput(input);
    const proposal = structuredClone(
      await this.provider.draft(structuredClone(input)),
    );
    assertWriterProposalBoundary(proposal);

    const titles = toTitles(proposal.titles);
    const cards = toCards(proposal.cards);
    const draft: GroundedDraft = {
      provider: { id: this.provider.id, mode: this.provider.mode },
      date: input.context.date,
      writer: structuredClone(input.context.writer),
      titles,
      blocks: proposal.blocks,
      body: renderDraftBody(proposal.blocks),
      hashtags: proposal.hashtags,
      cards,
      readerHook: proposal.readerHook,
      editorialAngle: proposal.editorialAngle,
      status: "draft",
    };
    assertGroundedDraft(draft, input);
    return draft;
  }
}
