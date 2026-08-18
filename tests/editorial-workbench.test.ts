import assert from "node:assert/strict";
import test from "node:test";

import type { Candidate, ResearchPack } from "../types/editorial.ts";
import { POST as candidatesPost } from "../app/api/editorial/candidates/route.ts";
import { assertSelectionResult } from "../lib/editorial-selection/index.ts";
import { ResearchVerificationEngine } from "../lib/research-verification/index.ts";
import { assertDailyEditorialPackage, isEditorialReviewStale } from "../lib/editorial-production/index.ts";
import { HttpJsonModelAdapter, HttpJsonSearchAdapter } from "../lib/editorial-workbench/live-adapters.ts";
import type { JsonModelAdapter, EditorialSearchAdapter } from "../lib/editorial-workbench/live-adapters.ts";
import { loadEditorialRuntimeConfig } from "../lib/editorial-workbench/config.ts";
import { getEditorialDate } from "../lib/editorial-workbench/date.ts";
import { OrchestrationError } from "../lib/editorial-workbench/errors.ts";
import { approveEditorialPackage, exportEditorialJson, exportEditorialMarkdown } from "../lib/editorial-workbench/human-review.ts";
import { LiveResearchEvidenceProvider } from "../lib/editorial-workbench/live-providers.ts";
import { createMockProviderFactory } from "../lib/editorial-workbench/providers.ts";
import type { WorkbenchProviderFactory } from "../lib/editorial-workbench/providers.ts";
import { createSafeSourceFetcher, isPrivateAddress } from "../lib/editorial-workbench/safe-fetch.ts";
import { EditorialWorkbenchService } from "../lib/editorial-workbench/service.ts";
import { EditorialSessionStore } from "../lib/editorial-workbench/store.ts";

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

test("A1: a stale Draft cannot be approved and callers cannot override staleness", async () => {
  const { production } = await completeFlow();
  const edited = structuredClone(production.data);
  edited.draft.blocks[0].text = "人工修改但没有重新 Review";
  edited.draft.body = edited.draft.blocks.map(({ text }) => text.trim()).join("\n\n");
  assert.throws(() => approveEditorialPackage(production.meta.packageId, edited), /binding|stale|review/i);
});

test("A2: Approval A cannot export Package B", async () => {
  const first = await completeFlow();
  const second = await completeFlow();
  const approval = approveEditorialPackage(first.production.meta.packageId, first.production.data);
  assert.throws(
    () => exportEditorialMarkdown(second.production.meta.packageId, second.production.data, approval, { preferredTitleIndex: 0, publishReady: true }),
    /different package/,
  );
});

test("A3: changing title, value, block or card invalidates old approval", async () => {
  const { production } = await completeFlow();
  const approval = approveEditorialPackage(production.meta.packageId, production.data);
  for (const mutate of [
    (value: typeof production.data) => { value.draft.titles[0].text += " 改"; },
    (value: typeof production.data) => { value.valueModules[0].content += " 改"; },
    (value: typeof production.data) => { value.draft.blocks[0].text += " 改"; value.draft.body = value.draft.blocks.map(({ text }) => text.trim()).join("\n\n"); },
    (value: typeof production.data) => { value.draft.cards[0].copy += " 改"; },
  ]) {
    const changed = structuredClone(production.data);
    mutate(changed);
    assert.throws(() => exportEditorialJson(production.meta.packageId, changed, approval, { preferredTitleIndex: 0, publishReady: true }), /binding|stale|review/i);
  }
});

test("A4: re-review clears prior approval until the editor approves again", async () => {
  const { service, production } = await completeFlow();
  await service.approve({ packageId: production.meta.packageId });
  const edited = structuredClone(production.data);
  edited.draft.blocks[0].text = "重新 review 的编辑内容";
  edited.draft.body = edited.draft.blocks.map(({ text }) => text.trim()).join("\n\n");
  await service.review({ packageId: production.meta.packageId, valueModules: edited.valueModules, draft: edited.draft });
  await assert.rejects(
    () => service.export({ packageId: production.meta.packageId, format: "json", preferredTitleIndex: 0, publishReady: true }),
    /human approval/,
  );
});

test("A5/A6: current review plus current approval exports while domain status stays draft", async () => {
  const { service, production } = await completeFlow();
  const editing = { status: "editing" as const };
  assert.equal(production.data.status, "draft");
  assert.match(exportEditorialMarkdown(production.meta.packageId, production.data, editing, { preferredTitleIndex: 0, publishReady: false }), /^# DRAFT/);
  const approved = await service.approve({ packageId: production.meta.packageId });
  assert.equal(approved.data.packageId, production.meta.packageId);
  assert.equal(production.data.status, "draft");
  const markdown = await service.export({ packageId: production.meta.packageId, format: "markdown", preferredTitleIndex: 0, publishReady: true });
  const json = await service.export({ packageId: production.meta.packageId, format: "json", preferredTitleIndex: 0, publishReady: true });
  assert.match(markdown.data.content, /TODAY'S PICK/);
  assert.equal(JSON.parse(json.data.content).exportStatus, "APPROVED");
});

test("S1: a connection-time switch from public DNS to private IP is rejected", async () => {
  const fetcher = createSafeSourceFetcher({ resolveHost: async () => ["93.184.216.34"], transport: async () => ({ response: new Response("ok", { headers: { "content-type": "text/plain" } }), connectedAddress: "10.0.0.8" }) });
  await assert.rejects(() => fetcher("https://public.example/source"), /changed after validation/);
});

test("S2: hexadecimal IPv4-mapped IPv6 loopback is rejected", async () => {
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  const fetcher = createSafeSourceFetcher({ transport: async () => assert.fail("transport must not run") });
  await assert.rejects(() => fetcher("http://[::ffff:7f00:1]/admin"), /Private/);
});

test("S3: public address and a separately bound safe redirect are allowed", async () => {
  const addresses: Record<string, string> = { "public.example": "93.184.216.34", "safe.example": "1.1.1.1" };
  const fetcher = createSafeSourceFetcher({
    resolveHost: async (hostname) => [addresses[hostname]],
    transport: async ({ url, address }) => url.hostname === "public.example"
      ? { response: new Response(null, { status: 302, headers: { location: "https://safe.example/final" } }), connectedAddress: address }
      : { response: new Response("safe", { headers: { "content-type": "text/plain" } }), connectedAddress: address },
  });
  assert.equal((await fetcher("https://public.example/start")).text, "safe");
});

test("S4: redirect to a private target is rejected before connecting", async () => {
  let connections = 0;
  const fetcher = createSafeSourceFetcher({
    resolveHost: async () => ["93.184.216.34"],
    transport: async ({ address }) => {
      connections += 1;
      return { response: new Response(null, { status: 302, headers: { location: "http://10.1.2.3/private" } }), connectedAddress: address };
    },
  });
  await assert.rejects(() => fetcher("https://public.example/start"), /Private/);
  assert.equal(connections, 1);
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

test("editorial date uses Asia/Shanghai across the UTC date boundary and rejects impossible dates", async () => {
  assert.equal(getEditorialDate(new Date("2026-08-17T15:59:59.000Z")), "2026-08-17");
  assert.equal(getEditorialDate(new Date("2026-08-17T16:00:00.000Z")), "2026-08-18");
  const service = new EditorialWorkbenchService({ providers: createMockProviderFactory() });
  for (const date of ["2026-02-30", "2026-13-01"]) {
    await assert.rejects(
      () => service.candidates({ date }),
      (error: unknown) => error instanceof OrchestrationError && error.code === "INVALID_EDITORIAL_DATE" && error.stage === "selection",
    );
  }
});

test("provider HTTP, timeout and invalid JSON errors retain the actual stage", async () => {
  const config = { provider: "test", baseUrl: "https://provider.example", apiKey: "test", model: "test" };
  const reviewAdapter = new HttpJsonModelAdapter({ ...config, fetchImpl: async () => new Response("failed", { status: 503 }) });
  await assert.rejects(
    () => reviewAdapter.generateJson("editorial_growth_review", {}),
    (error: unknown) => error instanceof OrchestrationError && error.stage === "review" && error.retryable,
  );
  const productionAdapter = new HttpJsonModelAdapter({ ...config, fetchImpl: async () => new Response("not-json") });
  await assert.rejects(
    () => productionAdapter.generateJson("grounded_editorial_draft", {}),
    (error: unknown) => error instanceof OrchestrationError && error.stage === "production" && error.code === "LIVE_PROVIDER_INVALID_RESPONSE" && !error.retryable,
  );
  const timeout = new Error("timeout"); timeout.name = "TimeoutError";
  const searchAdapter = new HttpJsonSearchAdapter({ provider: "test", baseUrl: "https://search.example", apiKey: "test", fetchImpl: async () => { throw timeout; } });
  await assert.rejects(
    () => searchAdapter.search("writer"),
    (error: unknown) => error instanceof OrchestrationError && error.stage === "research" && error.code === "LIVE_PROVIDER_TIMEOUT" && error.retryable,
  );
});

test("EditorialSessionStore expires sessions and deterministically caps entries", async () => {
  let now = 1_000;
  const store = new EditorialSessionStore({ ttlMs: 100, maxEntries: 2, now: () => now });
  const service = new EditorialWorkbenchService({ providers: createMockProviderFactory(), store });
  await service.candidates({ date: DATE });
  await service.candidates({ date: DATE });
  const latest = await service.candidates({ date: DATE });
  assert.equal(store.sizes().selections, 2);
  now += 101;
  await assert.rejects(
    () => service.research({ selectionId: latest.meta.selectionId, candidateId: latest.data.selectedCandidate.id }),
    (error: unknown) => error instanceof OrchestrationError && error.code === "SELECTION_SESSION_EXPIRED" && error.status === 410,
  );
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

test("Live Research keeps safe sources when sibling fetches fail and records structured skips", async () => {
  const model: JsonModelAdapter = {
    id: "partial-model",
    async generateJson<T>(task: string, input: unknown): Promise<T> {
      if (task === "editorial_research_queries") return { queries: ["writer archive"] } as T;
      const candidate = (input as { candidate: Candidate }).candidate;
      const evidence = [{ sourceId: "live-source-2", support: "direct" as const }];
      return {
        sourceMetadata: [{ sourceId: "live-source-2", sourceType: "institution", title: "Usable archive" }],
        claims: [
          { id: "date", claim: "Date", category: "date_event", evidence },
          { id: "bio", claim: "Bio", category: "bio", evidence },
          { id: "work", claim: "Work", category: "work", evidence },
          { id: "context", claim: "Context", category: "context", evidence },
        ],
        leadFindings: [{ evidenceLeadId: candidate.proposedWhyHerToday.evidenceLeads[0].id, researchClaimIds: ["date"] }],
      } as T;
    },
  };
  const search: EditorialSearchAdapter = { id: "partial-search", async search() { return [
    { url: "https://blocked.example/source", title: "Blocked" },
    { url: "https://archive.example/source", title: "Archive" },
  ]; } };
  const provider = new LiveResearchEvidenceProvider({
    model,
    search,
    fetchSource: async (url) => {
      if (url.includes("blocked")) throw new OrchestrationError({ stage: "research", code: "SOURCE_FETCH_FAILED", message: "HTTP 403", retryable: false });
      return { url, contentType: "text/html", text: "usable source" };
    },
  });
  const candidate = (await new EditorialWorkbenchService({ providers: createMockProviderFactory() }).candidates({ date: DATE })).data.selectedCandidate;
  const pack = await new ResearchVerificationEngine(provider).research(candidate);
  assert.equal(pack.sources.length, 1);
  assert.equal(pack.sources[0].url, "https://archive.example/source");
  assert.deepEqual(pack.retrievalDiagnostics?.skippedSources.map(({ code, url }) => ({ code, url })), [
    { code: "SOURCE_FETCH_FAILED", url: "https://blocked.example/source" },
  ]);
});
