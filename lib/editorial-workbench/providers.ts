import { MockEditorialHistoryProvider } from "../editorial-selection/mock-providers.ts";
import type { EditorialCandidateProvider, EditorialHistoryProvider } from "../editorial-selection/contracts.ts";
import type { ResearchEvidenceProvider } from "../research-verification/contracts.ts";
import type {
  EditorialReviewProvider,
  EditorialWriterProvider,
  ReaderValueProvider,
} from "../editorial-production/contracts.ts";
import type { EditorialRuntimeConfig } from "./config.ts";
import {
  HttpJsonModelAdapter,
  HttpJsonSearchAdapter,
} from "./live-adapters.ts";
import {
  LiveEditorialCandidateProvider,
  LiveEditorialReviewProvider,
  LiveEditorialWriterProvider,
  LiveReaderValueProvider,
  LiveResearchEvidenceProvider,
} from "./live-providers.ts";
import {
  WorkbenchMockCandidateProvider,
  WorkbenchMockResearchProvider,
  WorkbenchMockReviewProvider,
  WorkbenchMockValueProvider,
  WorkbenchMockWriterProvider,
} from "./mock-providers.ts";
import { createSafeSourceFetcher } from "./safe-fetch.ts";
import type { EditorialProviderMode } from "./types.ts";

export type ProductionProviders = {
  value: ReaderValueProvider;
  writer: EditorialWriterProvider;
  review: EditorialReviewProvider;
};

export interface WorkbenchProviderFactory {
  readonly mode: EditorialProviderMode;
  createCandidateProvider(): EditorialCandidateProvider & { calls?: Array<{ tier: "A" | "B" | "C"; discovered: number }> };
  createHistoryProvider(): EditorialHistoryProvider;
  createResearchProvider(): ResearchEvidenceProvider;
  createProductionProviders(): ProductionProviders;
  createReviewProvider(): EditorialReviewProvider;
}

export function createMockProviderFactory(): WorkbenchProviderFactory {
  return {
    mode: "mock",
    createCandidateProvider: () => new WorkbenchMockCandidateProvider(),
    createHistoryProvider: () => new MockEditorialHistoryProvider([], "workbench-mock-history"),
    createResearchProvider: () => new WorkbenchMockResearchProvider(),
    createProductionProviders: () => ({
      value: new WorkbenchMockValueProvider(),
      writer: new WorkbenchMockWriterProvider(),
      review: new WorkbenchMockReviewProvider(),
    }),
    createReviewProvider: () => new WorkbenchMockReviewProvider(),
  };
}

export function createLiveProviderFactory(config: EditorialRuntimeConfig): WorkbenchProviderFactory {
  if (!config.model || !config.search) throw new Error("Live provider configuration is incomplete");
  const model = new HttpJsonModelAdapter(config.model);
  const search = new HttpJsonSearchAdapter(config.search);
  return {
    mode: "live",
    createCandidateProvider: () => new LiveEditorialCandidateProvider(model),
    createHistoryProvider: () => new MockEditorialHistoryProvider([], "live-session-history"),
    createResearchProvider: () => new LiveResearchEvidenceProvider({
      model,
      search,
      fetchSource: createSafeSourceFetcher(),
    }),
    createProductionProviders: () => ({
      value: new LiveReaderValueProvider(model),
      writer: new LiveEditorialWriterProvider(model),
      review: new LiveEditorialReviewProvider(model),
    }),
    createReviewProvider: () => new LiveEditorialReviewProvider(model),
  };
}
