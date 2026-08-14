import type {
  DateRelevanceTier,
  EditorialRequest,
} from "../../types/editorial.ts";
import type {
  CandidateProposal,
  EditorialCandidateProvider,
  EditorialHistoryEntry,
  EditorialHistoryProvider,
} from "./contracts.ts";
import { daysBetweenDateOnly } from "./history.ts";

export type MockCandidateFixture = Omit<CandidateProposal, "provenance">;

export type MockCandidateFixtureSet = Record<
  string,
  Partial<Record<DateRelevanceTier, readonly MockCandidateFixture[]>>
>;

export class MockEditorialCandidateProvider
  implements EditorialCandidateProvider
{
  readonly id: string;
  readonly mode = "mock" as const;
  readonly calls: Array<{ date: string; tier: DateRelevanceTier }> = [];
  private readonly fixtures: MockCandidateFixtureSet;

  constructor(fixtures: MockCandidateFixtureSet, id = "mock-candidate-provider") {
    this.fixtures = fixtures;
    this.id = id;
  }

  async discover(
    request: EditorialRequest,
    tier: DateRelevanceTier,
  ): Promise<readonly CandidateProposal[]> {
    this.calls.push({ date: request.date, tier });

    const fixtures = this.fixtures[request.date]?.[tier] ?? [];
    return fixtures.map((fixture) => ({
      ...structuredClone(fixture),
      provenance: {
        providerId: this.id,
        providerMode: "mock" as const,
      },
    }));
  }
}

export class MockEditorialHistoryProvider implements EditorialHistoryProvider {
  readonly id: string;
  readonly mode = "mock" as const;
  private readonly entries: readonly EditorialHistoryEntry[];

  constructor(
    entries: readonly EditorialHistoryEntry[] = [],
    id = "mock-editorial-history",
  ) {
    this.entries = structuredClone(entries);
    this.id = id;
  }

  async listRecentEntries(
    beforeDate: string,
    windowDays: number,
  ): Promise<readonly EditorialHistoryEntry[]> {
    return this.entries
      .filter((entry) => {
        const daysAgo = daysBetweenDateOnly(beforeDate, entry.publishedDate);
        return daysAgo >= 0 && daysAgo <= windowDays;
      })
      .map((entry) => structuredClone(entry));
  }
}
