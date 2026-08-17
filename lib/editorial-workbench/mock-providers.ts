import type {
  Candidate,
  DateRelevanceTier,
  EditorialRequest,
  VerifiedEditorialContext,
  WriterInput,
} from "../../types/editorial.ts";
import type { CandidateProposal, EditorialCandidateProvider } from "../editorial-selection/contracts.ts";
import type { ResearchEvidenceProvider, ResearchInvestigation } from "../research-verification/contracts.ts";
import type {
  EditorialReviewInput,
  EditorialReviewProposal,
  EditorialReviewProvider,
  EditorialWriterProvider,
  ReaderValueProvider,
  ValueModuleProposal,
  WriterProposal,
} from "../editorial-production/contracts.ts";
import type { DiscoveryTraceEntry } from "./types.ts";

const MOCK_WRITERS = [
  { id: "mock-lin", name: "林澄（模拟）", knownFor: ["《潮汐书简》（模拟作品）"] },
  { id: "mock-su", name: "苏遥（模拟）", knownFor: ["《北窗》（模拟作品）"] },
  { id: "mock-qiao", name: "乔岚（模拟）", knownFor: ["《回声花园》（模拟作品）"] },
];

export class WorkbenchMockCandidateProvider implements EditorialCandidateProvider {
  readonly id = "workbench-mock-candidates";
  readonly mode = "mock" as const;
  readonly calls: DiscoveryTraceEntry[] = [];

  async discover(request: EditorialRequest, tier: DateRelevanceTier): Promise<readonly CandidateProposal[]> {
    const candidates = tier === "A" ? MOCK_WRITERS.map((writer, index) => ({
      id: `mock-candidate-${index + 1}`,
      writer,
      proposedWhyHerToday: {
        relationType: "birth" as const,
        relationDate: `190${index}-${request.date.slice(5)}`,
        tier,
        isEditorialLink: false,
        shortReason: "模拟档案中的同日诞辰关系",
        editorExplanation: "仅用于工作台流程演示，必须进入 Research 核验",
        evidenceLeads: [{
          id: `mock-date-lead-${index + 1}`,
          description: "核验模拟人物的日期关系",
          expectedSourceType: "institution" as const,
        }],
      },
      signals: {
        dateRelevance: 92 - index * 4,
        sourceAvailability: 86 - index * 3,
        recognition: 64 - index * 2,
        storyTension: 82 - index * 3,
        readerValue: 88 - index * 3,
        growthPotential: 79 - index * 2,
        herlitDistinctiveness: 90 - index * 4,
      },
      provenance: { providerId: this.id, providerMode: this.mode },
      editorialReason: "模拟候选具备明确日期入口、作品线索和可收藏阅读路径",
      risks: ["MOCK DATA：人物、作品与来源均为流程测试数据"],
    })) : [];
    this.calls.push({ tier, discovered: candidates.length });
    return candidates;
  }
}

export class WorkbenchMockResearchProvider implements ResearchEvidenceProvider {
  readonly id = "workbench-mock-research";
  readonly mode = "mock" as const;

  async investigate(candidate: Candidate): Promise<ResearchInvestigation> {
    const leadId = candidate.proposedWhyHerToday.evidenceLeads[0].id;
    const source = {
      id: "mock-archive",
      url: "https://example.test/herlit-mock-archive",
      title: "HerLit 模拟机构档案",
      publisher: "HerLit Mock Archive",
      sourceType: "institution" as const,
      retrievedAt: new Date().toISOString(),
      providerId: this.id,
      providerMode: this.mode,
    };
    const evidence = [{ sourceId: source.id, support: "direct" as const, locator: "mock record" }];
    return {
      sources: [source],
      claimProposals: [
        { id: "mock-date", claim: `${candidate.writer.name}的模拟日期关系`, category: "date_event", evidence },
        { id: "mock-bio", claim: `${candidate.writer.name}是一位模拟女性作家`, category: "bio", evidence },
        { id: "mock-work", claim: `${candidate.writer.knownFor[0]}是她的模拟代表作`, category: "work", evidence },
        { id: "mock-context", claim: "这部模拟作品以女性经验与自主选择为主题", category: "context", evidence },
      ],
      leadFindings: [{ evidenceLeadId: leadId, researchClaimIds: ["mock-date"] }],
    };
  }
}

export class WorkbenchMockValueProvider implements ReaderValueProvider {
  readonly id = "workbench-mock-value";
  readonly mode = "mock" as const;
  async propose(context: VerifiedEditorialContext): Promise<readonly ValueModuleProposal[]> {
    const work = context.claims.find(({ category }) => category === "work")!;
    const history = context.claims.find(({ category }) => category === "context")!;
    return [
      { type: "where_to_start", title: "从哪一本开始", content: work.claim, readerBenefit: "帮第一次遇见她的读者确定第一本阅读入口", evidenceClaimIds: [work.id] },
      { type: "literary_history", title: "把作品放回语境", content: history.claim, readerBenefit: "为读者保存一条理解作品女性经验的语境线索", evidenceClaimIds: [history.id] },
    ];
  }
}

export class WorkbenchMockWriterProvider implements EditorialWriterProvider {
  readonly id = "workbench-mock-writer";
  readonly mode = "mock" as const;
  async draft(input: WriterInput): Promise<WriterProposal> {
    const { context } = input;
    const dateId = context.whyHerToday.evidenceClaimIds[0];
    const bio = context.claims.find(({ category }) => category === "bio")!;
    const work = context.claims.find(({ category }) => category === "work")!;
    const historical = context.claims.find(({ category }) => category === "context")!;
    return {
      titles: [
        { text: `今天，记住${context.writer.name}`, angle: "日期入口", evidenceClaimIds: [dateId] },
        { text: `从${context.writer.knownFor[0]}开始认识她`, angle: "阅读入口", evidenceClaimIds: [work.id] },
        { text: "她怎样把女性经验写进作品", angle: "作品意义", evidenceClaimIds: [historical.id] },
      ],
      blocks: [
        { id: "hook", role: "hook", text: "有些名字，值得从一条可靠的阅读路径开始记住。", evidenceClaimIds: [] },
        { id: "why", role: "why_today", text: context.whyHerToday.shortReason, evidenceClaimIds: [dateId] },
        { id: "story", role: "story", text: `${bio.claim}。${work.claim}。`, evidenceClaimIds: [bio.id, work.id] },
        { id: "meaning", role: "meaning", text: `${historical.claim}。`, evidenceClaimIds: [historical.id] },
        { id: "value", role: "value", text: `如果第一次读她，可以先从${context.writer.knownFor[0]}开始。`, evidenceClaimIds: [work.id] },
        { id: "interaction", role: "interaction", text: "你希望下一次从哪位女性作家开始？", evidenceClaimIds: [] },
      ],
      hashtags: ["#HerLit", "#girltalk", "#她文日历", "#女性文学"],
      cards: [
        { order: 1, role: "cover", title: `今天记住${context.writer.name}`, copy: "一个可靠的阅读入口", visualDirection: "深绿人物封面，暖象牙标题", evidenceClaimIds: [] },
        { order: 2, role: "why_her_today", title: "为什么是今天", copy: context.whyHerToday.shortReason, visualDirection: "日期档案卡", evidenceClaimIds: [dateId] },
        { order: 3, role: "reading_path", title: "从哪里开始", copy: context.writer.knownFor[0], visualDirection: "朱红书签式作品卡", evidenceClaimIds: [work.id] },
      ],
      readerHook: "从日期与作品之间建立第一次认识",
      editorialAngle: "用核验事实给出可收藏的女性文学入口",
      status: "draft",
    };
  }
}

export class WorkbenchMockReviewProvider implements EditorialReviewProvider {
  readonly id = "workbench-mock-review";
  readonly mode = "mock" as const;
  async review(input: EditorialReviewInput): Promise<EditorialReviewProposal> {
    void input;
    return {
      growthNotes: {
        clickReason: "日期入口与具体人物构成了清楚而克制的点击理由",
        readThroughReason: "人物、作品与意义逐步展开，形成连续阅读节奏",
        saveReason: "明确的第一本作品建议可以直接保存为阅读入口",
        commentReason: "结尾邀请读者提出下一位想认识的女性作家",
        followReason: "读者会预期 HerLit 持续替她筛选可靠、可开始阅读的女性文学人物与作品",
      },
      issues: [],
      recommendation: "ready_for_human_review",
      status: "draft",
    };
  }
}
