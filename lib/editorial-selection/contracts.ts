import type {
  Candidate,
  CandidateSignals,
  DateRelevanceTier,
  EditorialRequest,
} from "../../types/editorial.ts";

export type CandidateProposal = Omit<Candidate, "rank" | "score">;

export interface EditorialCandidateProvider {
  readonly id: string;
  readonly mode: "mock" | "live";

  discover(
    request: EditorialRequest,
    tier: DateRelevanceTier,
  ): Promise<readonly CandidateProposal[]>;
}

export type EditorialHistoryEntry = {
  writerId: string;
  publishedDate: string;
  /** Reserved for a future non-vector topic-similarity policy. */
  topicKeys?: string[];
};

export interface EditorialHistoryProvider {
  readonly id: string;
  readonly mode: "mock" | "local" | "live";

  listRecentEntries(
    beforeDate: string,
    windowDays: number,
  ): Promise<readonly EditorialHistoryEntry[]>;
}

export type CandidateSignalKey = keyof CandidateSignals;
