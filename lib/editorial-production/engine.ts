import type {
  DailyEditorialPackage,
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
  ): Promise<DailyEditorialPackage> {
    assertSelectionResult(selection);
    if (researchPack.candidateId !== selection.selectedCandidate.id) {
      throw new Error("ResearchPack must belong to the selected candidate");
    }
    if (researchPack.writer.id !== selection.selectedCandidate.writer.id) {
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
    );
  }
}
