import assert from "node:assert/strict";
import test from "node:test";

import type { Candidate, ResearchPack } from "../types/editorial.ts";
import { POST as candidatesPost } from "../app/api/editorial/candidates/route.ts";
import { assertSelectionResult } from "../lib/editorial-selection/index.ts";
import { ResearchVerificationEngine } from "../lib/research-verification/index.ts";
import { assertDailyEditorialPackage, isEditorialReviewStale } from "../lib/editorial-production/index.ts";
import type { JsonModelAdapter, EditorialSearchAdapter } from "../lib/editorial-workbench/live-adapters.ts";
import { loadEditorialRuntimeConfig } from "../lib/editorial-workbench/config.ts";
import { OrchestrationError } from "../lib/editorial-workbench/errors.ts";
import { approveEditorialPackage, exportEditorialJson, exportEditorialMarkdown } from "../lib/editorial-workbench/human-review.ts";
import { LiveResearchEvidenceProvider } from "../lib/editorial-workbench/live-providers.ts";
import { createMockProviderFactory } from "../lib/editorial-workbench/providers.ts";
import type { WorkbenchProviderFactory } from "../lib/editorial-workbench/providers.ts";
import { createSafeSourceFetcher } from "../lib/editorial-workbench/safe-fetch.ts";
import { EditorialWorkbenchService } from "../lib/editorial-workbench/service.ts";

const DATE = "2026-08-17";

async function completeFlow(service = new EditorialWorkbenchService({ providers: createMockProviderFactory() })) {
  const candidates = await service.candidates({ date: DATE });
  const research = await service.research({
    selectionId: candidates.meta.selectionId,
    selection: candidates.data,
    candidateId: candidates.data.selectedCandidate.id,
  });
  const production = await service.produce({
    selectionId: candidates.meta.selectionId,
    researchId: research.meta.researchId,
    selection: candidates.data,
    researchPack: research.data,
  });
  return { service, candidates, research, production };
}

test("I1/I2: date-only candidate API returns a 3–5 member selection", async () => {
  process.env.EDITORIAL_PROVIDER_MODE = "mock";
  const response = await candidatesPost(new Request("http://localhost/api/editorial/candidates", {
    method: "POST",
    body: JSON.stringify({ date: DATE }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(response.status, 200);
  const payload = await response.json() as { data: Parameters<typeof assertSelectionResult>[0]; meta: { providerMode: string } };
  assert.doesNotThrow(() => assertSelectionResult(payload.data));
  assert.ok(payload.data.candidateShortlist.length >= 3 && payload.data.candidateShortlist.length <= 5);
  assert.equal(payload.meta.providerMode, "mock");
});

test("I3: mock mode is explicit in API metadata and provider provenance", async () => {
  const result = await new EditorialWorkbenchService({ providers: createMockProviderFactory() }).candidates({ date: DATE });
  assert.equal(result.meta.providerMode, "mock");
  assert.ok(result.data.candidateShortlist.every(({ provenance }) => provenance.providerMode === "mock"));
});

test("I4: research candidate must belong to the stored shortlist", async () => {
  const service = new EditorialWorkbenchService({ providers: createMockProviderFactory() });
  const candidates = await service.candidates({ date: DATE });
  await assert.rejects(
    () => service.research({ selectionId: candidates.meta.selectionId, candidateId: "not-in-shortlist" }),
    (error: unknown) => error instanceof OrchestrationError && error.code === "CANDIDATE_NOT_IN_SHORTLIST",
  );
});

function notReadyFactory(): WorkbenchProviderFactory {
  const base = createMockProviderFactory();
  return {
    ...base,
    createResearchProvider: () => ({
      id: "not-ready-research",
      mode: "mock" as const,
      async investigate(candidate: Candidate) {
        const source = { id: "only-source", url: "https://example.test/only", title: "Only source", sourceType: "institution" as const, retrievedAt: new Date().toISOString(), providerId: "not-ready-research", providerMode: "mock" as const };
        return {
          sources: [source],
          claimProposals: [{ id: "only-date", claim: "Only a date", category: "date_event" as const, evidence: [{ sourceId: source.id, support: "direct" as const }] }],
          leadFindings: [{ evidenceLeadId: candidate.proposedWhyHerToday.evidenceLeads[0].id, researchClaimIds: ["only-date"] }],
        };
      },
    }),
  };
}

test("I5/I8: not-ready server Research blocks production even if client forges verified", async () => {
  const service = new EditorialWorkbenchService({ providers: notReadyFactory() });
  const candidates = await service.candidates({ date: DATE });
  const research = await service.research({ selectionId: candidates.meta.selectionId, candidateId: candidates.data.selectedCandidate.id });
  assert.equal(research.data.readyForDraft, false);
  const forged = structuredClone(research.data) as ResearchPack;
  forged.readyForDraft = true;
  await assert.rejects(
    () => service.produce({ selectionId: candidates.meta.selectionId, researchId: research.meta.researchId, researchPack: forged }),
    (error: unknown) => error instanceof OrchestrationError && error.code === "RESEARCH_NOT_DRAFT_READY",
  );
});

test("I6/I7: ready Research produces a transport-safe DailyEditorialPackage", async () => {
  const { production } = await completeFlow();
  const transported = JSON.parse(JSON.stringify(production.data));
  assert.doesNotThrow(() => assertDailyEditorialPackage(transported));
});

test("I9: forged client weightedTotal and rank are ignored in Research", async () => {
  const service = new EditorialWorkbenchService({ providers: createMockProviderFactory() });
  const candidates = await service.candidates({ date: DATE });
  const forged = structuredClone(candidates.data);
  forged.candidateShortlist[0].score.weightedTotal = 0;
  forged.candidateShortlist[0].rank = 5;
  const research = await service.research({
    selectionId: candidates.meta.selectionId,
    selection: forged,
    candidateId: candidates.data.selectedCandidate.id,
  });
  assert.equal(research.data.writer.id, candidates.data.selectedCandidate.writer.id);
});

test("I10/I11: edit makes review stale and re-review creates a valid new binding", async () => {
  const { service, production } = await completeFlow();
  const edited = structuredClone(production.data);
  edited.draft.blocks[0].text = "这是人工修改后的非事实 Hook。";
  edited.draft.body = edited.draft.blocks.map(({ text }) => text.trim()).join("\n\n");
  assert.equal(isEditorialReviewStale(edited.review.reviewedInputBinding, {
    context: edited.verifiedContext,
    valueModules: edited.valueModules,
    draft: edited.draft,
  }), true);
  const reviewed = await service.review({
    packageId: production.meta.packageId,
    valueModules: edited.valueModules,
    draft: edited.draft,
  });
  assert.equal(isEditorialReviewStale(reviewed.data.review.reviewedInputBinding, {
    context: reviewed.data.verifiedContext,
    valueModules: reviewed.data.valueModules,
    draft: reviewed.data.draft,
  }), false);
});

test("I12: an automated Writer attempting approved is rejected", async () => {
  const base = createMockProviderFactory();
  const badFactory: WorkbenchProviderFactory = {
    ...base,
    createProductionProviders() {
      const providers = base.createProductionProviders();
      return {
        ...providers,
        writer: {
          id: "bad-writer",
          mode: "mock" as const,
          async draft(input) {
            const valid = await providers.writer.draft(input);
            return { ...valid, status: "approved" } as unknown as typeof valid;
          },
        },
      };
    },
  };
  const service = new EditorialWorkbenchService({ providers: badFactory });
  const candidates = await service.candidates({ date: DATE });
  const research = await service.research({ selectionId: candidates.meta.selectionId, candidateId: candidates.data.selectedCandidate.id });
  await assert.rejects(() => service.produce({ selectionId: candidates.meta.selectionId, researchId: research.meta.researchId }), /approved status/);
});

test("I13/I14/I15: human approval remains outer state and gates publish-ready exports", async () => {
  const { production } = await completeFlow();
  const editing = { status: "editing" as const };
  assert.equal(production.data.status, "draft");
  assert.throws(() => exportEditorialMarkdown(production.data, editing, { preferredTitleIndex: 0, publishReady: true }), /human approval/);
  assert.match(exportEditorialMarkdown(production.data, editing, { preferredTitleIndex: 0, publishReady: false }), /^# DRAFT/);
  const approved = approveEditorialPackage(production.data, false, new Date("2026-08-17T10:00:00.000Z"));
  assert.equal(production.data.status, "draft");
  assert.equal(approved.status, "approved");
  assert.match(exportEditorialMarkdown(production.data, approved, { preferredTitleIndex: 0, publishReady: true }), /TODAY'S PICK/);
  assert.equal(JSON.parse(exportEditorialJson(production.data, approved, { preferredTitleIndex: 0, publishReady: true })).exportStatus, "APPROVED");
});

test("I16: safe source fetch rejects localhost, private IP and private redirect", async () => {
  const fetcher = createSafeSourceFetcher({
    resolveHost: async (hostname) => hostname === "public.example" ? ["93.184.216.34"] : ["127.0.0.1"],
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://192.168.1.5/secret" } }),
  });
  await assert.rejects(() => fetcher("http://localhost/admin"), /localhost/);
  await assert.rejects(() => fetcher("http://127.0.0.1/admin"), /Private/);
  await assert.rejects(() => fetcher("https://public.example/source"), /Private/);
});

test("I17: unavailable live configuration returns a structured stage error", () => {
  const before = { ...process.env };
  process.env.EDITORIAL_PROVIDER_MODE = "live";
  delete process.env.EDITORIAL_MODEL_PROVIDER;
  try {
    assert.throws(
      () => loadEditorialRuntimeConfig(),
      (error: unknown) => error instanceof OrchestrationError && error.code === "LIVE_PROVIDER_UNAVAILABLE" && error.stage === "selection",
    );
  } finally {
    process.env = before;
  }
});

test("I18: live Research uses fetched URLs while mock provenance stays mock", async () => {
  let extractionCalls = 0;
  const model: JsonModelAdapter = {
    id: "fake-live-model",
    async generateJson<T>(task: string, input: unknown): Promise<T> {
      if (task === "editorial_research_queries") return { queries: ["writer archive"] } as T;
      extractionCalls += 1;
      const candidate = (input as { candidate: Candidate }).candidate;
      const leadId = candidate.proposedWhyHerToday.evidenceLeads[0].id;
      const evidence = [{ sourceId: "live-source-1", support: "direct" as const }];
      return {
        sourceMetadata: [{ sourceId: "live-source-1", sourceType: "institution", title: "Real archive" }],
        claims: [
          { id: "live-date", claim: "Live date", category: "date_event", evidence },
          { id: "live-bio", claim: "Live bio", category: "bio", evidence },
          { id: "live-work", claim: "Live work", category: "work", evidence },
          { id: "live-context", claim: "Live context", category: "context", evidence },
        ],
        leadFindings: [{ evidenceLeadId: leadId, researchClaimIds: ["live-date"] }],
      } as T;
    },
  };
  const search: EditorialSearchAdapter = { id: "fake-live-search", async search() { return [{ url: "https://archive.example/writer", title: "Archive" }]; } };
  const provider = new LiveResearchEvidenceProvider({
    model,
    search,
    fetchSource: async (url) => ({ url, contentType: "text/html", text: "Fetched primary source" }),
  });
  const candidate = (await new EditorialWorkbenchService({ providers: createMockProviderFactory() }).candidates({ date: DATE })).data.selectedCandidate;
  const pack = await new ResearchVerificationEngine(provider).research(candidate);
  assert.equal(pack.provider.mode, "live");
  assert.equal(pack.sources[0].url, "https://archive.example/writer");
  assert.ok(pack.sources.every(({ providerMode }) => providerMode === "live"));
  assert.equal(extractionCalls, 1);

  const mock = await completeFlow();
  assert.equal(mock.research.data.provider.mode, "mock");
  assert.ok(mock.research.data.sources.every(({ providerMode }) => providerMode === "mock"));
});
