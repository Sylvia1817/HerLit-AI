import type {
  DailyEditorialPackage,
  EditorialSelectionOverride,
  EditorialSelectionResult,
  ResearchPack,
  WriterInput,
} from "../../types/editorial.ts";
import { assertSelectionResult } from "../editorial-selection/engine.ts";
import type {
  EditorialReviewProvider,
  EditorialWriterProvider,
  ReaderValueProvider,
} from "./contracts.ts";
import { buildVerifiedEditorialContext } from "./context.ts";
import { EditorialWriterEngine, HERLIT_BRAND_RULES } from "./draft-engine.ts";
import { assembleDailyEditorialPackage } from "./package.ts";
import { EditorialReviewEngine } from "./review-engine.ts";
import { ReaderValueEngine } from "./value-engine.ts";

export class DailyEditorialProductionEngine {
  private readonly valueEngine: ReaderValueEngine;
  private readonly writerEngine: EditorialWriterEngine;
  private readonly reviewEngine: EditorialReviewEngine;

  constructor(
    valueProvider: ReaderValueProvider,
    writerProvider: EditorialWriterProvider,
    reviewProvider: EditorialReviewProvider,
  ) {
    this.valueEngine = new ReaderValueEngine(valueProvider);
    this.writerEngine = new EditorialWriterEngine(writerProvider);
    this.reviewEngine = new EditorialReviewEngine(reviewProvider);
  }

  async produce(
    selection: EditorialSelectionResult,
    researchPack: ResearchPack,
    style?: string | null,
    editorOverride?: EditorialSelectionOverride,
  ): Promise<DailyEditorialPackage> {
    assertSelectionResult(selection);
    const selectedCandidate = editorOverride
      ? selection.candidateShortlist.find(({ id }) => id === editorOverride.selectedCandidateId)
      : selection.selectedCandidate;
    if (!selectedCandidate) throw new Error("Editor override candidate must belong to the shortlist");
    if (editorOverride && (
      editorOverride.originalSelectedCandidateId !== selection.selectedCandidate.id ||
      editorOverride.selectedCandidateId === selection.selectedCandidate.id ||
      !editorOverride.reason.trim() ||
      !Number.isFinite(Date.parse(editorOverride.overriddenAt))
    )) {
      throw new Error("Editor override must preserve and explain the original Selection decision");
    }
    if (researchPack.candidateId !== selectedCandidate.id) {
      throw new Error("ResearchPack must belong to the selected candidate");
    }
    if (researchPack.writer.id !== selectedCandidate.writer.id) {
      throw new Error("ResearchPack must belong to the selected writer");
    }
    const context = buildVerifiedEditorialContext(researchPack, selection.date);
    const valueModules = await this.valueEngine.create(context);
    const writerInput: WriterInput = {
      context,
      valueModules,
      style,
      brandRules: HERLIT_BRAND_RULES,
    };
    const draft = await this.writerEngine.create(writerInput);
    const review = await this.reviewEngine.create({
      context,
      valueModules,
      draft,
    });
    return assembleDailyEditorialPackage(
      selection,
      researchPack,
      context,
      valueModules,
      draft,
      review,
      editorOverride,
    );
  }
}
