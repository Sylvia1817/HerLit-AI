import assert from "node:assert/strict";
import test from "node:test";

import type {
  Candidate,
  DailyEditorialPackage,
  EditorialSelectionResult,
  GroundedDraft,
  ResearchPack,
  ValueModule,
  WriterInput,
} from "../types/editorial.ts";
import {
  DailyEditorialProductionEngine,
  EditorialReviewEngine,
  EditorialWriterEngine,
  HERLIT_BRAND_RULES,
  MockEditorialReviewProvider,
  MockEditorialWriterProvider,
  MockReaderValueProvider,
  assertDailyEditorialPackage,
  assertGroundedDraft,
  assertValueModules,
  buildQuoteAttribution,
  buildVerifiedEditorialContext,
} from "../lib/editorial-production/index.ts";
import type {
  EditorialReviewProposal,
  WriterProposal,
} from "../lib/editorial-production/index.ts";
import {
  MockResearchEvidenceProvider,
  ResearchVerificationEngine,
} from "../lib/research-verification/index.ts";

const DATE = "2026-08-17";

function candidate(id: string, rank: number, score: number): Candidate {
  return {
    id,
    writer: { id: `writer-${id}`, name: `作家 ${id}`, knownFor: ["代表作"] },
    proposedWhyHerToday: {
      relationType: "birth",
      relationDate: "1900-08-17",
      tier: "A",
      isEditorialLink: false,
      shortReason: "今天是她的诞辰",
      editorExplanation: "由机构档案核验诞辰日期",
      evidenceLeads: [{ id: "lead-date", description: "核验诞辰" }],
    },
    signals: {
      dateRelevance: 90,
      sourceAvailability: 85,
      recognition: 70,
      storyTension: 75,
      readerValue: 80,
      growthPotential: 70,
      herlitDistinctiveness: 80,
    },
    score: { weightedBase: score, recentRepeatPenalty: 0, weightedTotal: score },
    provenance: { providerId: "mock-selection", providerMode: "mock" },
    rank,
    editorialReason: "有可靠材料和明确的读者入口",
    risks: [],
  };
}

function selection(): EditorialSelectionResult {
  const shortlist = [
    candidate("selected", 1, 80),
    candidate("second", 2, 75),
    candidate("third", 3, 70),
  ] as EditorialSelectionResult["candidateShortlist"];
  return {
    date: DATE,
    candidateShortlist: shortlist,
    selectionDecision: {
      selectedCandidateId: "selected",
      whySelected: "综合表现最好",
      whyNotOthers: [
        { candidateId: "second", reason: "读者入口略弱" },
        { candidateId: "third", reason: "材料密度略低" },
      ],
    },
    selectedCandidate: structuredClone(shortlist[0]),
  };
}

async function readyPack(): Promise<ResearchPack> {
  const selected = selection().selectedCandidate;
  const provider = new MockResearchEvidenceProvider({
    selected: {
      sources: [
        {
          id: "archive",
          url: "https://example.test/archive",
          title: "机构档案",
          publisher: "Archive",
          sourceType: "institution",
          retrievedAt: "2026-08-17T00:00:00.000Z",
        },
        {
          id: "edition",
          url: "https://example.test/edition",
          title: "权威版本",
          publisher: "Publisher",
          sourceType: "publisher",
          retrievedAt: "2026-08-17T00:00:00.000Z",
        },
      ],
      claimProposals: [
        { id: "date", claim: "她生于 1900 年 8 月 17 日", category: "date_event", evidence: [{ sourceId: "archive", support: "direct" }] },
        { id: "bio", claim: "她长期坚持写作", category: "bio", evidence: [{ sourceId: "archive", support: "direct" }] },
        { id: "work", claim: "《代表作》是她的重要作品", category: "work", evidence: [{ sourceId: "edition", support: "direct" }] },
        { id: "context", claim: "作品回应了女性处境", category: "context", evidence: [{ sourceId: "archive", support: "direct" }] },
        {
          id: "quote-character",
          claim: "我要为自己选择生活",
          category: "quote",
          evidence: [{
            sourceId: "edition",
            support: "direct",
            excerpt: "我要为自己选择生活",
            quoteSpeakerContext: {
              speakerType: "character",
              speakerName: "主人公",
              documentType: "work",
              workOrDocument: "《代表作》",
            },
          }],
          quoteContext: { attributedSpeakerType: "character", attributedSpeakerName: "主人公" },
        },
        { id: "seductive-rejected", claim: "一个很诱人的冷知识", category: "bio", evidence: [] },
      ],
      leadFindings: [{ evidenceLeadId: "lead-date", researchClaimIds: ["date"] }],
    },
  });
  return new ResearchVerificationEngine(provider).research(selected);
}

function valueModules(characterLabel: string): ValueModule[] {
  return [
    {
      type: "where_to_start",
      title: "第一次读她，从这里开始",
      content: "先读《代表作》，再回看她如何写女性选择。",
      readerBenefit: "帮第一次接触她的读者决定先读哪一本",
      evidenceClaimIds: ["work"],
    },
    {
      type: "literary_history",
      title: "把作品放回它的时代",
      content: "这部作品回应了女性处境。",
      readerBenefit: "让读者保存一条理解作品历史环境的线索",
      evidenceClaimIds: ["context"],
    },
    {
      type: "verified_quote",
      title: "一句值得记住的话",
      content: `${characterLabel}：“我要为自己选择生活。”`,
      readerBenefit: "保存引语时也能准确记住真正的说话者",
      evidenceClaimIds: ["quote-character"],
      quoteAttributions: [{ claimId: "quote-character", speakerType: "character", speakerName: "主人公", label: characterLabel }],
    },
  ];
}

function writerProposal(characterLabel: string): WriterProposal {
  return {
    titles: [
      { text: "今天，记住这位生于 8 月 17 日的作家", angle: "日期入口", evidenceClaimIds: ["date"] },
      { text: "从《代表作》开始认识她", angle: "阅读入口", evidenceClaimIds: ["work"] },
      { text: "她如何写下女性的选择", angle: "作品意义", evidenceClaimIds: ["context"] },
    ],
    blocks: [
      { id: "hook", role: "hook", text: "有些作家，值得在今天重新遇见。", evidenceClaimIds: [] },
      { id: "why", role: "why_today", text: "今天是她的诞辰。", evidenceClaimIds: ["date"] },
      { id: "story", role: "story", text: "她长期坚持写作，《代表作》成为重要作品。", evidenceClaimIds: ["bio", "work"] },
      { id: "meaning", role: "meaning", text: "作品把女性处境写进具体选择。", evidenceClaimIds: ["context"] },
      { id: "value", role: "value", text: `${characterLabel}：“我要为自己选择生活。”`, evidenceClaimIds: ["quote-character"], quoteAttributions: [{ claimId: "quote-character", speakerType: "character", speakerName: "主人公", label: characterLabel }] },
      { id: "interaction", role: "interaction", text: "你会从哪一本开始读她？", evidenceClaimIds: [] },
    ],
    hashtags: ["#HerLit", "#girltalk", "#她文日历", "#女性文学"],
    cards: [
      { order: 1, role: "cover", title: "今天记住她", copy: "一个阅读入口", visualDirection: "克制的人物封面", evidenceClaimIds: [] },
      { order: 2, role: "why_her_today", title: "为什么是今天", copy: "今天是她的诞辰", visualDirection: "日期卡", evidenceClaimIds: ["date"] },
      { order: 3, role: "reading_path", title: "从哪里开始", copy: "先读《代表作》", visualDirection: "书封卡", evidenceClaimIds: ["work"] },
    ],
    readerHook: "在日期入口里遇见一个具体的人",
    editorialAngle: "用作品和女性处境建立阅读路径",
    status: "draft",
  };
}

function reviewProposal(): EditorialReviewProposal {
  return {
    growthNotes: {
      clickReason: "日期入口与具体人物形成了清楚的点击理由",
      readThroughReason: "从人物到作品再到意义的推进能维持阅读",
      saveReason: "明确的作品起点让读者可以保存为阅读清单",
      commentReason: "结尾邀请读者说出自己的第一本选择",
      followReason: "这篇给出可保存的阅读路径，让读者预期 HerLit 会持续替她筛选女性文学入口",
    },
    issues: [],
    recommendation: "ready_for_human_review",
    status: "draft",
  };
}

async function fixtures() {
  const pack = await readyPack();
  const context = buildVerifiedEditorialContext(pack, DATE);
  const quote = context.quoteClaims[0];
  const attribution = buildQuoteAttribution(quote);
  const modules = valueModules(attribution.label);
  const proposal = writerProposal(attribution.label);
  const input: WriterInput = { context, valueModules: modules as WriterInput["valueModules"], brandRules: HERLIT_BRAND_RULES };
  const writer = new EditorialWriterEngine(new MockEditorialWriterProvider("mock-writer", proposal));
  const draft = await writer.create(input);
  return { pack, context, attribution, modules, proposal, input, draft };
}

async function completePackage(): Promise<DailyEditorialPackage> {
  const pack = await readyPack();
  const context = buildVerifiedEditorialContext(pack, DATE);
  const attribution = buildQuoteAttribution(context.quoteClaims[0]);
  const engine = new DailyEditorialProductionEngine(
    new MockReaderValueProvider("mock-value", valueModules(attribution.label)),
    new MockEditorialWriterProvider(
      "mock-writer",
      writerProposal(attribution.label),
    ),
    new MockEditorialReviewProvider("mock-review", reviewProposal()),
  );
  return engine.produce(selection(), pack);
}

test("W1: VerifiedEditorialContext excludes rejected claims completely", async () => {
  const { context } = await fixtures();
  assert.equal(context.claims.some(({ id }) => id === "seductive-rejected"), false);
});

test("W2: Value Module rejects missing or rejected claim IDs", async () => {
  const { context, modules } = await fixtures();
  for (const badId of ["missing", "seductive-rejected"]) {
    const bad = structuredClone(modules);
    bad[0].evidenceClaimIds = [badId];
    assert.throws(() => assertValueModules(bad, context));
  }
});

test("W3: where_to_start must cite a work claim", async () => {
  const { context, modules } = await fixtures();
  const bad = structuredClone(modules);
  bad[0].evidenceClaimIds = ["bio"];
  assert.throws(() => assertValueModules(bad, context), /work claim/);
});

test("W4: verified_quote must cite a quote claim", async () => {
  const { context, modules } = await fixtures();
  const bad = structuredClone(modules);
  bad[2].evidenceClaimIds = ["work"];
  delete bad[2].quoteAttributions;
  assert.throws(() => assertValueModules(bad, context), /quote claim/);
});

test("W5: a correctly labelled character quote is accepted", async () => {
  const { context, modules } = await fixtures();
  assert.doesNotThrow(() => assertValueModules(modules, context));
});

test("W6: Writer cannot change a character quote into an author quote", async () => {
  const { draft, input } = await fixtures();
  const bad = structuredClone(draft);
  const block = bad.blocks.find(({ id }) => id === "value")!;
  block.text = "作者本人说：“我要为自己选择生活。”";
  block.quoteAttributions = [{ claimId: "quote-character", speakerType: "author", label: "作者本人说" }];
  bad.body = bad.blocks.map(({ text }) => text.trim()).join("\n\n");
  assert.throws(() => assertGroundedDraft(bad, input), /attribution/);
});

test("W7: a factual DraftBlock cannot cite a missing claim", async () => {
  const { draft, input } = await fixtures();
  const bad = structuredClone(draft);
  bad.blocks.find(({ id }) => id === "story")!.evidenceClaimIds = ["missing"];
  bad.body = bad.blocks.map(({ text }) => text.trim()).join("\n\n");
  assert.throws(() => assertGroundedDraft(bad, input), /unavailable claim/);
});

test("W8: Hook and interaction blocks may have no evidence", async () => {
  const { draft, input } = await fixtures();
  assert.equal(draft.blocks.find(({ role }) => role === "hook")!.evidenceClaimIds.length, 0);
  assert.equal(draft.blocks.find(({ role }) => role === "interaction")!.evidenceClaimIds.length, 0);
  assert.doesNotThrow(() => assertGroundedDraft(draft, input));
});

test("W9: Why Her Today card must cite date evidence", async () => {
  const { draft, input } = await fixtures();
  const bad = structuredClone(draft);
  bad.cards.find(({ role }) => role === "why_her_today")!.evidenceClaimIds = ["work"];
  assert.throws(() => assertGroundedDraft(bad, input), /date evidence/);
});

test("W10: card counts below 3 or above 6 are rejected", async () => {
  const { draft, input } = await fixtures();
  const tooFew = structuredClone(draft) as GroundedDraft;
  tooFew.cards = tooFew.cards.slice(0, 2) as GroundedDraft["cards"];
  assert.throws(() => assertGroundedDraft(tooFew, input), /3–6 cards/);
  const tooMany = structuredClone(draft) as GroundedDraft;
  tooMany.cards = [...tooMany.cards, ...structuredClone(tooMany.cards), structuredClone(tooMany.cards[0])].map((card, index) => ({ ...card, order: index + 1 })) as GroundedDraft["cards"];
  assert.throws(() => assertGroundedDraft(tooMany, input), /3–6 cards/);
});

test("W11: a title cannot smuggle in a missing fact claim ID", async () => {
  const { draft, input } = await fixtures();
  const bad = structuredClone(draft);
  bad.titles[0].evidenceClaimIds = ["invented-award"];
  assert.throws(() => assertGroundedDraft(bad, input), /unavailable claim/);
});

test("W12: Writer proposal cannot output approved", async () => {
  const { input, proposal } = await fixtures();
  const bad = { ...proposal, status: "approved" } as unknown as WriterProposal;
  const engine = new EditorialWriterEngine(new MockEditorialWriterProvider("bad-writer", bad));
  await assert.rejects(() => engine.create(input), /cannot output approved/);
});

test("W13: Growth Review cannot change Research or Draft facts", async () => {
  const { context, modules, draft } = await fixtures();
  const bad = { ...reviewProposal(), draft: { body: "rewritten" } } as unknown as EditorialReviewProposal;
  const engine = new EditorialReviewEngine(new MockEditorialReviewProvider("bad-review", bad));
  await assert.rejects(() => engine.create({ context, valueModules: modules as WriterInput["valueModules"], draft }), /cannot output or change draft/);
});

test("W14: complete production flow yields a grounded draft package", async () => {
  const pack = await readyPack();
  const context = buildVerifiedEditorialContext(pack, DATE);
  const attribution = buildQuoteAttribution(context.quoteClaims[0]);
  const engine = new DailyEditorialProductionEngine(
    new MockReaderValueProvider("mock-value", valueModules(attribution.label)),
    new MockEditorialWriterProvider("mock-writer", writerProposal(attribution.label)),
    new MockEditorialReviewProvider("mock-review", reviewProposal()),
  );
  const result = await engine.produce(selection(), pack);
  assert.equal(result.valueModules.length, 3);
  assert.equal(result.draft.titles.length, 3);
  assert.equal(result.draft.cards.length, 3);
  assert.equal(result.review.recommendation, "ready_for_human_review");
  assert.equal(result.status, "draft");
});

test("W15: structuredClone preserves every package runtime invariant", async () => {
  const pack = await readyPack();
  const context = buildVerifiedEditorialContext(pack, DATE);
  const attribution = buildQuoteAttribution(context.quoteClaims[0]);
  const engine = new DailyEditorialProductionEngine(
    new MockReaderValueProvider("mock-value", valueModules(attribution.label)),
    new MockEditorialWriterProvider("mock-writer", writerProposal(attribution.label)),
    new MockEditorialReviewProvider("mock-review", reviewProposal()),
  );
  const cloned = structuredClone(await engine.produce(selection(), pack)) as DailyEditorialPackage;
  assert.doesNotThrow(() => assertDailyEditorialPackage(cloned));
});

test("Step 4.1: Review A cannot be attached to a different valid Draft B", async () => {
  const packageA = await completePackage();
  const mixed = structuredClone(packageA);
  mixed.draft.blocks.find(({ id }) => id === "hook")!.text =
    "Draft B 使用了另一个仍然非事实性的开头。";
  mixed.draft.body = mixed.draft.blocks
    .map(({ text }) => text.trim())
    .join("\n\n");

  assert.throws(
    () => assertDailyEditorialPackage(mixed),
    /bound to different reviewed inputs/,
  );
});

test("Step 4.1: Review Provider cannot choose its own input binding", async () => {
  const { context, modules, draft } = await fixtures();
  const providerOwned = {
    ...reviewProposal(),
    reviewedInputBinding: {
      revision: "editorial-review-input/v1",
      algorithm: "sha256",
      fingerprint: "0".repeat(64),
    },
  } as unknown as EditorialReviewProposal;
  const engine = new EditorialReviewEngine(
    new MockEditorialReviewProvider("bad-review", providerOwned),
  );

  await assert.rejects(
    () =>
      engine.create({
        context,
        valueModules: modules as WriterInput["valueModules"],
        draft,
      }),
    /cannot output or change reviewedInputBinding/,
  );
});

test("Step 4.1: transported stages cannot be reassembled with another writer", async () => {
  const transported = structuredClone(await completePackage());
  transported.researchAudit.writer.id = "writer-other";
  transported.verifiedContext.writer.id = "writer-other";
  transported.draft.writer.id = "writer-other";

  assert.throws(
    () => assertDailyEditorialPackage(transported),
    /writer identities must match/,
  );
});

test("Step 4.1: quote claim ID and speaker cannot hide changed quote wording", async () => {
  const { context, modules, draft, input, attribution } = await fixtures();

  const badModules = structuredClone(modules);
  badModules[2].content = `${attribution.label}：“我要替别人选择生活。”`;
  assert.throws(
    () => assertValueModules(badModules, context),
    /canonical quote text/,
  );

  const badBlockDraft = structuredClone(draft);
  badBlockDraft.blocks.find(({ id }) => id === "value")!.text =
    `${attribution.label}：“我要替别人选择生活。”`;
  badBlockDraft.body = badBlockDraft.blocks
    .map(({ text }) => text.trim())
    .join("\n\n");
  assert.throws(
    () => assertGroundedDraft(badBlockDraft, input),
    /canonical quote text/,
  );

  const quoteCardDraft = structuredClone(draft);
  const quoteCard = quoteCardDraft.cards[2];
  quoteCard.title = "一句值得记住的话";
  quoteCard.copy = `${attribution.label}：“我要为自己选择生活。”`;
  quoteCard.evidenceClaimIds = ["quote-character"];
  quoteCard.quoteAttributions = [attribution];
  assert.doesNotThrow(() => assertGroundedDraft(quoteCardDraft, input));

  quoteCard.copy = `${attribution.label}：“我要替别人选择生活。”`;
  assert.throws(
    () => assertGroundedDraft(quoteCardDraft, input),
    /canonical quote text/,
  );
});
