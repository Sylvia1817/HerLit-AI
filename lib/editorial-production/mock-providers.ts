import type {
  EditorialReviewInput,
  EditorialReviewProposal,
  EditorialReviewProvider,
  EditorialWriterProvider,
  ReaderValueProvider,
  ValueModuleProposal,
  WriterProposal,
} from "./contracts.ts";
import type {
  VerifiedEditorialContext,
  WriterInput,
} from "../../types/editorial.ts";

export class MockReaderValueProvider implements ReaderValueProvider {
  readonly mode = "mock" as const;
  readonly id: string;
  private readonly proposals: ValueModuleProposal[];

  constructor(id: string, proposals: ValueModuleProposal[]) {
    this.id = id;
    this.proposals = structuredClone(proposals);
  }

  async propose(
    context: VerifiedEditorialContext,
  ): Promise<ValueModuleProposal[]> {
    void context;
    return structuredClone(this.proposals);
  }
}

export class MockEditorialWriterProvider implements EditorialWriterProvider {
  readonly mode = "mock" as const;
  readonly id: string;
  private readonly proposal: WriterProposal;

  constructor(id: string, proposal: WriterProposal) {
    this.id = id;
    this.proposal = structuredClone(proposal);
  }

  async draft(input: WriterInput): Promise<WriterProposal> {
    void input;
    return structuredClone(this.proposal);
  }
}

export class MockEditorialReviewProvider implements EditorialReviewProvider {
  readonly mode = "mock" as const;
  readonly id: string;
  private readonly proposal: EditorialReviewProposal;

  constructor(id: string, proposal: EditorialReviewProposal) {
    this.id = id;
    this.proposal = structuredClone(proposal);
  }

  async review(input: EditorialReviewInput): Promise<EditorialReviewProposal> {
    void input;
    return structuredClone(this.proposal);
  }
}
