/**
 * Transport-level contracts shared by live adapters and providers.
 *
 * These interfaces are intentionally narrow: a model adapter only has to turn
 * a task into one JSON payload, and a search adapter only has to return
 * traceable http(s) URLs. Domain validation stays in the domain engines.
 */

import type {
  CardPlan,
  DraftBlock,
  DraftTitle,
  EditorialIssue,
  GrowthNotes,
  ValueModule,
} from "../../../types/editorial.ts";

export interface JsonModelAdapter {
  readonly id: string;
  generateJson<T>(task: string, input: unknown): Promise<T>;
}

export type SearchResult = { url: string; title: string; snippet?: string };

export interface EditorialSearchAdapter {
  readonly id: string;
  search(query: string): Promise<readonly SearchResult[]>;
}

export type LiveWriterPayload = {
  titles: DraftTitle[];
  blocks: DraftBlock[];
  hashtags: string[];
  cards: CardPlan[];
  readerHook: string;
  editorialAngle: string;
  status: "draft";
};

export type LiveReviewPayload = {
  growthNotes: GrowthNotes;
  issues: EditorialIssue[];
  recommendation: "ready_for_human_review" | "needs_revision";
  status: "draft";
};

export type LiveValuePayload = { modules: ValueModule[] };
