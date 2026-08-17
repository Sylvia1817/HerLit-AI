import type {
  CardPlan,
  DraftBlock,
  DraftTitle,
  EditorialIssue,
  GrowthNotes,
  GroundedDraft,
  ResearchProviderMode,
  ValueModule,
  VerifiedEditorialContext,
  WriterInput,
} from "../../types/editorial.ts";

export type ValueModuleProposal = ValueModule;

export interface ReaderValueProvider {
  readonly id: string;
  readonly mode: ResearchProviderMode;

  propose(
    context: VerifiedEditorialContext,
  ): Promise<readonly ValueModuleProposal[]>;
}

export type WriterProposal = {
  titles: DraftTitle[];
  blocks: DraftBlock[];
  hashtags: string[];
  cards: CardPlan[];
  readerHook: string;
  editorialAngle: string;
  status: "draft";
};

export interface EditorialWriterProvider {
  readonly id: string;
  readonly mode: ResearchProviderMode;

  draft(input: WriterInput): Promise<WriterProposal>;
}

export type EditorialReviewInput = {
  context: VerifiedEditorialContext;
  valueModules: WriterInput["valueModules"];
  draft: GroundedDraft;
};

export type EditorialReviewProposal = {
  growthNotes: GrowthNotes;
  issues: EditorialIssue[];
  recommendation: "ready_for_human_review" | "needs_revision";
  status: "draft";
};

export interface EditorialReviewProvider {
  readonly id: string;
  readonly mode: ResearchProviderMode;

  review(input: EditorialReviewInput): Promise<EditorialReviewProposal>;
}
