import assert from "node:assert/strict";
import test from "node:test";

import { assertDailyEditorialPackage, EditorialWriterEngine, HERLIT_BRAND_RULES } from "../lib/editorial-production/index.ts";
import type { EditorialWriterProvider, WriterProposal } from "../lib/editorial-production/contracts.ts";
import type { WriterInput } from "../types/editorial.ts";
import type { WorkbenchProviderFactory } from "../lib/editorial-workbench/providers.ts";
import { EditorialWorkbenchService } from "../lib/editorial-workbench/service.ts";
import { MockEditorialHistoryProvider } from "../lib/editorial-selection/mock-providers.ts";
import {
  LiveEditorialCandidateProvider,
  LiveEditorialReviewProvider,
  LiveEditorialWriterProvider,
  LiveResearchEvidenceProvider,
  LiveReaderValueProvider,
} from "../lib/editorial-workbench/live-providers.ts";
import { OpenAIChatModelAdapter } from "../lib/editorial-workbench/live/model-adapters.ts";
import { normalizeTaskPayload } from "../lib/editorial-workbench/live/normalize.ts";
import { TaskContractError } from "../lib/editorial-workbench/live/tasks.ts";
import type { EditorialSearchAdapter } from "../lib/editorial-workbench/live/contracts.ts";
import { OrchestrationError } from "../lib/editorial-workbench/errors.ts";
import { createMockProviderFactory } from "../lib/editorial-workbench/providers.ts";
import { decodeBody, htmlToText } from "../lib/editorial-workbench/html-to-text.ts";

type CompactClaim = { id: string; claim: string; category: string };
type CompactContext = {
  writer: { id: string; name: string; knownFor: string[] };
  whyHerToday: { shortReason: string; evidenceClaimIds: string[] };
  claims: CompactClaim[];
};

function claimOf(context: CompactContext, category: string): CompactClaim {
  const claim = context.claims.find((item) => item.category === category);
  assert.ok(claim, `missing ${category} claim in fixture`);
  return claim;
}

function writerPayloadFor(context: CompactContext): Record<string, unknown> {
  const work = claimOf(context, "work");
  const bio = claimOf(context, "bio");
  const contextual = claimOf(context, "context");
  const whyIds = context.whyHerToday.evidenceClaimIds;
  return {
    titles: [
      { text: `今天，记住${context.writer.name}`, angle: "日期入口", evidenceClaimIds: whyIds },
      { text: `从${context.writer.knownFor[0]}开始`, angle: "阅读入口", evidenceClaimIds: [work.id] },
      { text: "她写下的女性经验", angle: "作品意义", evidenceClaimIds: [contextual.id] },
    ],
    blocks: [
      { id: "hook", role: "hook", text: "有些名字，值得从一条可靠的阅读路径开始记住。", evidenceClaimIds: [] },
      { id: "why", role: "why_today", text: context.whyHerToday.shortReason, evidenceClaimIds: whyIds },
      { id: "story", role: "story", text: bio.claim, evidenceClaimIds: [bio.id] },
      { id: "meaning", role: "meaning", text: contextual.claim, evidenceClaimIds: [contextual.id] },
      { id: "value", role: "value", text: `可以先从${context.writer.knownFor[0]}读起。`, evidenceClaimIds: [work.id, contextual.id] },
      { id: "interaction", role: "interaction", text: "你想下一位读到谁？", evidenceClaimIds: [] },
    ],
    hashtags: ["#HerLit", "#girltalk", "#她文日历"],
    cards: [
      { order: 1, role: "cover", title: `今天记住${context.writer.name}`, copy: "一个可靠的阅读入口", visualDirection: "深绿封面", evidenceClaimIds: [] },
      { order: 2, role: "why_her_today", title: "为什么是今天", copy: context.whyHerToday.shortReason, visualDirection: "日期档案卡", evidenceClaimIds: whyIds },
      { order: 3, role: "work", title: "从哪一本开始", copy: work.claim, visualDirection: "书签卡", evidenceClaimIds: [work.id] },
    ],
    readerHook: "从日期与作品之间建立第一次认识",
    editorialAngle: "用核验事实给出可收藏的女性文学入口",
    status: "draft",
  };
}

/** A fake vendor transport that answers each task with a contract-valid body. */
function fakeVendorFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0].content;
    const user = JSON.parse(body.messages[1].content) as Record<string, unknown>;

    let payload: unknown;
    if (system.includes('"candidates"')) {
      payload = {
        candidates: ["弗吉尼亚·伍尔夫", "西尔维娅·普拉斯", "张爱玲"].map((name, index) => ({
          id: `candidate-${index + 1}`,
          writer: { id: `writer-${index + 1}`, name, knownFor: ["《一部作品》（1925）"] },
          proposedWhyHerToday: {
            relationType: "birth",
            relationDate: "1891-01-25",
            tier: "A",
            isEditorialLink: false,
            shortReason: `${name}的出生日与今天同日`,
            editorExplanation: "待档案核验的同日出生关系",
            evidenceLeads: [{ id: `lead-${index + 1}`, description: "核验出生日期", expectedSourceType: "institution" }],
          },
          signals: {
            dateRelevance: 94 - index * 3,
            sourceAvailability: 88,
            recognition: 76,
            storyTension: 84,
            readerValue: 88,
            growthPotential: 78,
            herlitDistinctiveness: 90,
          },
          editorialReason: "日期入口清晰，且有机构档案可核验",
          risks: ["需核验首版年份"],
        })),
      };
    } else if (system.includes('"queries"')) {
      payload = { queries: ["Virginia Woolf archive", "Woolf 1925 first edition"] };
    } else if (system.includes('"leadFindings"')) {
      const sourceId = (user.sourceIdList as string[])[0];
      const leadId = (user.requiredLeadIds as string[])[0];
      const evidence = [{ sourceId, support: "direct", locator: "档案首段", excerpt: "born on 25 January 1882 in London" }];
      payload = {
        sourceMetadata: [{ sourceId, sourceType: "institution", title: "National archive record", publisher: "National Archive" }],
        claims: [
          { id: "claim-date", claim: "她出生于 1882 年 1 月 25 日", category: "date_event", evidence },
          { id: "claim-bio", claim: "她是英国小说家与散文作者", category: "bio", evidence },
          { id: "claim-work", claim: "《达洛维夫人》首版于 1925 年", category: "work", evidence },
          { id: "claim-context", claim: "她的写作持续讨论女性经验与自主选择", category: "context", evidence },
        ],
        leadFindings: [{ evidenceLeadId: leadId, researchClaimIds: ["claim-date", "claim-bio"] }],
      };
    } else if (system.includes('"modules"')) {
      const claims = ((user.context as CompactContext).claims ?? []).map((claim) => claim.id);
      payload = {
        modules: [
          { type: "where_to_start", title: "从哪一本开始", content: "《达洛维夫人》是合适的第一个入口。", readerBenefit: "让第一次读她的读者有明确的第一本书", evidenceClaimIds: [claims[2]] },
          { type: "literary_history", title: "放回文学史", content: "她把女性经验写成了持续的实验。", readerBenefit: "为读者保存一条理解女性写作的语境线索", evidenceClaimIds: [claims[3]] },
        ],
      };
    } else if (system.includes('"titles"')) {
      payload = writerPayloadFor(user.context as CompactContext);
    } else {
      payload = {
        growthNotes: {
          clickReason: "日期入口与具体人物构成了清楚的点击理由",
          readThroughReason: "人物、作品与意义逐步展开，形成连续节奏",
          saveReason: "明确的第一本作品建议可以直接保存",
          commentReason: "结尾邀请读者提出下一位想认识的人",
          followReason: "读者会预期 HerLit 持续替她筛选可靠的女性文学入口",
        },
        issues: [],
        recommendation: "ready_for_human_review",
      };
    }

    return Response.json({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] });
  };
}

function liveFactory(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): WorkbenchProviderFactory {
  const model = new OpenAIChatModelAdapter({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-4.1-mini",
    maxAttempts: 2,
    fetchImpl: fetchImpl as typeof fetch,
  });
  const search: EditorialSearchAdapter = {
    id: "fake-search",
    async search() {
      return [
        { url: "https://archive.example/woolf", title: "Archive record" },
        { url: "https://archive.example/woolf-works", title: "Works" },
      ];
    },
  };
  return {
    mode: "live",
    createCandidateProvider: () => new LiveEditorialCandidateProvider(model),
    createHistoryProvider: () => new MockEditorialHistoryProvider([], "test-history"),
    createResearchProvider: () => new LiveResearchEvidenceProvider({
      model,
      search,
      fetchSource: async (url) => ({ url, contentType: "text/html", text: "Born on 25 January 1882. Mrs Dalloway was published in 1925." }),
    }),
    createProductionProviders: () => ({
      value: new LiveReaderValueProvider(model),
      writer: new LiveEditorialWriterProvider(model),
      review: new LiveEditorialReviewProvider(model),
    }),
    createReviewProvider: () => new LiveEditorialReviewProvider(model),
  };
}

test("a live transport with real adapters produces a valid reviewed draft package", async () => {
  const service = new EditorialWorkbenchService({ providers: liveFactory(fakeVendorFetch()) });

  const candidates = await service.candidates({ date: "2026-01-25" });
  assert.equal(candidates.meta.providerMode, "live");
  assert.equal(candidates.data.candidateShortlist.length, 3);
  assert.ok(candidates.data.candidateShortlist.every(({ provenance }) => provenance.providerMode === "live"));

  const research = await service.research({
    selectionId: candidates.meta.selectionId,
    candidateId: candidates.data.selectedCandidate.id,
  });
  assert.equal(research.data.provider.mode, "live");
  assert.equal(research.data.readyForDraft, true, "verified institutional evidence should unlock drafting");
  assert.ok(research.data.sources.every(({ url }) => url.startsWith("https://archive.example/")));

  const production = await service.produce({
    selectionId: candidates.meta.selectionId,
    researchId: research.meta.researchId,
  });
  assert.doesNotThrow(() => assertDailyEditorialPackage(production.data));
  assert.equal(production.data.status, "draft");
  assert.ok(production.data.draft.hashtags.includes("#她文日历"));
  assert.deepEqual(production.data.draft.cards.map(({ order }) => order), [1, 2, 3]);
  assert.match(production.data.draft.body, /为什么是今天|出生日|这一周/);
});

test("an unrepairable writer output fails with a contract violation instead of a partial draft", async () => {
  const { production } = await (async () => {
    const service = new EditorialWorkbenchService({ providers: createMockProviderFactory() });
    const candidates = await service.candidates({ date: "2026-01-25" });
    const research = await service.research({ selectionId: candidates.meta.selectionId, candidateId: candidates.data.selectedCandidate.id });
    const produced = await service.produce({ selectionId: candidates.meta.selectionId, researchId: research.meta.researchId });
    return { production: produced };
  })();

  let calls = 0;
  const adapter = new OpenAIChatModelAdapter({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-4.1-mini",
    maxAttempts: 2,
    fetchImpl: (async () => {
      calls += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ titles: [] }) }, finish_reason: "stop" }] });
    }) as typeof fetch,
  });

  const writerProvider: EditorialWriterProvider = {
    id: adapter.id,
    mode: "live",
    draft: (input: WriterInput) => adapter.generateJson<WriterProposal>("grounded_editorial_draft", input),
  };

  await assert.rejects(
    () => new EditorialWriterEngine(writerProvider).create({
      context: production.data.verifiedContext,
      valueModules: production.data.valueModules,
      style: null,
      brandRules: HERLIT_BRAND_RULES,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OrchestrationError);
      assert.equal(error.code, "LIVE_CONTENT_CONTRACT_VIOLATION");
      assert.equal(error.stage, "production");
      return true;
    },
  );
  assert.equal(calls, 2, "one repair attempt is made before failing");
});

test("writer output is repaired with program-owned hashtags, card order and status", async () => {
  const service = new EditorialWorkbenchService({ providers: createMockProviderFactory() });
  const candidates = await service.candidates({ date: "2026-01-25" });
  const research = await service.research({ selectionId: candidates.meta.selectionId, candidateId: candidates.data.selectedCandidate.id });
  const produced = await service.produce({ selectionId: candidates.meta.selectionId, researchId: research.meta.researchId });
  const input = {
    context: produced.data.verifiedContext,
    valueModules: produced.data.valueModules,
    style: null,
    brandRules: HERLIT_BRAND_RULES,
  };

  const context = produced.data.verifiedContext;
  const payload: Record<string, unknown> = {
    ...writerPayloadFor({
      writer: { id: context.writer.id, name: context.writer.name, knownFor: context.writer.knownFor },
      whyHerToday: { shortReason: context.whyHerToday.shortReason, evidenceClaimIds: context.whyHerToday.evidenceClaimIds },
      claims: context.claims.map(({ id, claim, category }) => ({ id, claim, category })),
    }),
    hashtags: ["女性文学"],
    body: "这是模型自己写的 body，必须被丢弃",
    status: "approved",
  };
  payload.cards = (payload.cards as Array<Record<string, unknown>>)
    .map((card, index) => ({ ...card, order: 9 - index }));

  const draft = await new EditorialWriterEngine({
    id: "normalizing-writer",
    mode: "live",
    async draft() {
      return normalizeTaskPayload("grounded_editorial_draft", payload, input) as never;
    },
  }).create(input);

  assert.equal(draft.status, "draft");
  for (const hashtag of ["#HerLit", "#girltalk", "#她文日历"]) assert.ok(draft.hashtags.includes(hashtag));
  assert.deepEqual(draft.cards.map(({ order }) => order), [1, 2, 3]);
  assert.ok(!draft.body.includes("模型自己写的 body"), "body is rendered from blocks, never taken from the model");
  assert.ok(draft.body.length > 0);
});

test("candidate normalization rejects tier mismatches and enforces editorial-link semantics", () => {
  const raw = {
    candidates: [
      {
        id: "a",
        writer: { id: "w-a", name: "作家甲" },
        proposedWhyHerToday: {
          relationType: "birth", tier: "B", isEditorialLink: false,
          shortReason: "理由", editorExplanation: "说明",
          evidenceLeads: [{ id: "lead-1", description: "核验" }],
        },
        signals: { dateRelevance: 80, sourceAvailability: 80, recognition: 80, storyTension: 80, readerValue: 80, growthPotential: 80, herlitDistinctiveness: 80 },
      },
      {
        id: "b",
        writer: { id: "w-b", name: "作家乙" },
        proposedWhyHerToday: {
          relationType: "seasonal_editorial_link", tier: "C", isEditorialLink: false,
          shortReason: "季节关联", editorExplanation: "编辑型关联",
          evidenceLeads: [{ id: "lead-1", description: "核验" }],
        },
        signals: { dateRelevance: 70, sourceAvailability: 70, recognition: 70, storyTension: 70, readerValue: 70, growthPotential: 70, herlitDistinctiveness: 70 },
      },
    ],
  };

  assert.throws(
    () => normalizeTaskPayload("editorial_candidate_discovery", raw, { tier: "A" }),
    (error: unknown) => error instanceof TaskContractError &&
      error.violations.some((violation) => violation.includes("本 tier 只接受") || violation.includes("tier")),
  );

  const tierOnly = { candidates: raw.candidates.filter((candidate) => candidate.proposedWhyHerToday.tier === "C") };
  const tierC = normalizeTaskPayload("editorial_candidate_discovery", tierOnly, { tier: "C" }) as {
    candidates: Array<{ proposedWhyHerToday: { isEditorialLink: boolean }; evidenceLeads?: unknown }>;
  };
  assert.equal(tierC.candidates.length, 1);
  assert.equal(tierC.candidates[0].proposedWhyHerToday.isEditorialLink, true, "Tier C is an editorial link by definition");
});

test("claim extraction keeps only supplied source ids and resolves every lead", () => {
  const input = {
    sources: [{ sourceId: "live-source-1", url: "https://archive.example/a", content: "text" }],
    candidate: { proposedWhyHerToday: { evidenceLeads: [{ id: "lead-1" }, { id: "lead-2" }] } },
  };
  const raw = {
    sourceMetadata: [
      { sourceId: "live-source-1", sourceType: "institution", title: "Archive" },
      { sourceId: "invented-source", sourceType: "official", title: "Hallucinated" },
    ],
    claims: [
      {
        id: "claim-a",
        claim: "她出生于 1882 年",
        category: "date_event",
        evidence: [
          { sourceId: "live-source-1", support: "direct", excerpt: "born 1882" },
          { sourceId: "invented-source", support: "direct", excerpt: "fabricated" },
        ],
      },
      { id: "claim-a", claim: "重复 id 的 claim", category: "bio", evidence: [{ sourceId: "live-source-1", support: "direct" }] },
      { id: "claim-c", claim: "类别非法的 claim", category: "rumour", evidence: [] },
    ],
    leadFindings: [{ evidenceLeadId: "lead-1", researchClaimIds: ["claim-a"] }],
  };

  const normalized = normalizeTaskPayload("editorial_claim_extraction", raw, input) as {
    sourceMetadata: Array<{ sourceId: string }>;
    claims: Array<{ id: string; evidence: Array<{ sourceId: string }> }>;
    leadFindings: Array<{ evidenceLeadId: string; researchClaimIds: string[]; emptyStatus?: string }>;
  };

  assert.deepEqual(normalized.sourceMetadata.map(({ sourceId }) => sourceId), ["live-source-1"]);
  assert.deepEqual(normalized.claims.map(({ id }) => id), ["claim-a", "claim-a-2"]);
  assert.ok(normalized.claims.every(({ evidence }) => evidence.every(({ sourceId }) => sourceId === "live-source-1")));
  assert.equal(normalized.leadFindings.length, 2);
  assert.equal(normalized.leadFindings[1].evidenceLeadId, "lead-2");
  assert.equal(normalized.leadFindings[1].emptyStatus, "needs_review");
});

test("review normalization refuses ready-for-review when an error issue exists", () => {
  const normalized = normalizeTaskPayload("editorial_growth_review", {
    growthNotes: {
      clickReason: "标题给出了具体的日期入口与人物",
      readThroughReason: "段落从人物走向作品再落到阅读建议",
      saveReason: "第一本作品建议可以直接保存使用",
      commentReason: "结尾的问题与本文的阅读经验相关",
      followReason: "读者会期待 HerLit 继续筛选可靠的女性文学入口",
    },
    issues: [{ code: "unsupported-fact", severity: "error", message: "作品首版年份缺少来源" }],
    recommendation: "ready_for_human_review",
  }, {}) as { recommendation: string; status: string };

  assert.equal(normalized.recommendation, "needs_revision");
  assert.equal(normalized.status, "draft");
});

test("strict normalization reports violations that a repair round can use", () => {
  assert.throws(
    () => normalizeTaskPayload("editorial_growth_review", { growthNotes: {}, issues: [] }, {}),
    (error: unknown) => error instanceof TaskContractError && error.violations.length >= 5,
  );
});

test("html extraction strips markup and keeps readable sentences", () => {
  const html = `<html><head><title>t</title><style>.a{color:red}</style></head>
    <body><nav>menu</nav><article><h1>Virginia Woolf</h1>
    <p>Born on 25&nbsp;January 1882 in London.</p>
    <script>window.tracker=1</script>
    <p>Her essay &ldquo;A Room of One&rsquo;s Own&rdquo; is discussed.</p></article></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /Virginia Woolf/);
  assert.match(text, /Born on 25 January 1882 in London\./);
  assert.match(text, /Her essay “A Room of One’s Own” is discussed\./);
  assert.ok(!text.includes("window.tracker"));
  assert.ok(!text.includes("<p>"));
});

test("body decoding honours declared charset", () => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
  assert.equal(decodeBody(latin1, "text/plain; charset=ISO-8859-1"), "café");
  const utf8 = new TextEncoder().encode("她文日历");
  assert.equal(decodeBody(utf8, "text/html; charset=utf-8"), "她文日历");
  const metaOnly = new TextEncoder().encode('<meta charset="utf-8">她');
  assert.match(decodeBody(metaOnly, "text/html"), /她/);
});
