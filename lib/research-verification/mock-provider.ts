import type {
  Candidate,
  ResearchSource,
} from "../../types/editorial.ts";
import type {
  EvidenceLeadFinding,
  ResearchClaimProposal,
  ResearchEvidenceProvider,
  ResearchInvestigation,
} from "./contracts.ts";

export type MockResearchSource = Omit<
  ResearchSource,
  "providerId" | "providerMode"
>;

export type MockResearchFixture = {
  sources: readonly MockResearchSource[];
  claimProposals: readonly ResearchClaimProposal[];
  leadFindings: readonly EvidenceLeadFinding[];
};

export class MockResearchEvidenceProvider implements ResearchEvidenceProvider {
  readonly mode = "mock" as const;
  readonly calls: string[] = [];
  readonly id: string;
  private readonly fixtures: Readonly<Record<string, MockResearchFixture>>;

  constructor(
    fixtures: Readonly<Record<string, MockResearchFixture>>,
    id = "mock-research-evidence-provider",
  ) {
    this.fixtures = fixtures;
    this.id = id;
  }

  async investigate(candidate: Candidate): Promise<ResearchInvestigation> {
    this.calls.push(candidate.id);
    const fixture = this.fixtures[candidate.id];
    if (!fixture) {
      throw new Error(`No mock research fixture for candidate ${candidate.id}`);
    }

    return {
      sources: fixture.sources.map((source) => ({
        ...structuredClone(source),
        providerId: this.id,
        providerMode: this.mode,
      })),
      claimProposals: structuredClone([...fixture.claimProposals]),
      leadFindings: structuredClone([...fixture.leadFindings]),
    };
  }
}
