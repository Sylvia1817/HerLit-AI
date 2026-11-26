/**
 * Machine-facing task contracts for live model adapters.
 *
 * `prompts/*.md` stays the human editorial specification. This module is the
 * runtime mirror that a real chat model receives: the exact JSON shape, the
 * hard constraints that the server re-validates, and the repair notice used
 * when a previous attempt violated the contract.
 */

import type {
  ResearchSourceType,
  VerifiedEditorialContext,
  WriterInput,
} from "../../../types/editorial.ts";
import { buildQuoteAttribution } from "../../editorial-production/grounding.ts";
import type { EditorialReviewInput } from "../../editorial-production/contracts.ts";

export const MODEL_TASKS = [
  "editorial_candidate_discovery",
  "editorial_research_queries",
  "editorial_claim_extraction",
  "reader_value_modules",
  "grounded_editorial_draft",
  "editorial_growth_review",
] as const;

export type ModelTask = (typeof MODEL_TASKS)[number];

export function isModelTask(value: string): value is ModelTask {
  return (MODEL_TASKS as readonly string[]).includes(value);
}

export type PromptPair = { system: string; user: string };

export class TaskContractError extends Error {
  readonly task: ModelTask;
  readonly violations: readonly string[];

  constructor(task: ModelTask, violations: readonly string[]) {
    super(`${task} output violated the task contract: ${violations.join("; ")}`);
    this.name = "TaskContractError";
    this.task = task;
    this.violations = violations;
  }
}

export const SOURCE_TYPE_GUIDE = `sourceType 判断标准（不确定时用 secondary）：
- official：作家官网、遗产/版权基金会、奖项官方页
- institution：大学、博物馆、文学研究机构、国家级文化机构
- library：国家或公共图书馆目录、档案馆、数字化馆藏
- publisher：原出版社或权威版本页面
- reputable_media：有编辑与事实核查把关的媒体、学术性二手资料
- secondary：百科聚合、UGC、语录站、营销号，只能作为线索`;

const JSON_ONLY = `只输出一个 JSON 对象。不要输出解释、前后缀文字、Markdown 标题或代码块围栏。所有字符串使用简体中文（人名原文、书名原文、URL、claimId 除外）。`;

const SELECTION_RULES: Record<string, string> = {
  A: "Tier A 只接受与发布日期同月同日、且有明确文学意义的强关联：出生、去世、作品首版、获奖、重要人生事件。relationType 只能是 birth/death/publication/award/life_event，isEditorialLink 必须为 false。",
  B: "Tier B 是同一自然月内的强关联：relationType 使用 month_link，isEditorialLink 必须为 false；relationDate 写你判断的月内日期或省略，不要伪装成同一天。",
  C: "Tier C 是有史料依据的柔性编辑关联（月份、季节、书信、日记、创作经历）：relationType 使用 seasonal_editorial_link，isEditorialLink 必须为 true，并在 shortReason 与 editorExplanation 中坦诚说明这是编辑型关联。",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function compactClaim(claim: { id: string; claim: string; category: string; quoteContext?: unknown }) {
  return claim.quoteContext
    ? { id: claim.id, claim: claim.claim, category: claim.category, quoteContext: claim.quoteContext }
    : { id: claim.id, claim: claim.claim, category: claim.category };
}

/** Writer/Value/Review prompts receive claims, never sources or audit trail. */
function reduceContext(context: VerifiedEditorialContext | undefined) {
  return {
    date: context?.date ?? null,
    writer: context?.writer ?? null,
    whyHerToday: context?.whyHerToday ?? null,
    claims: Array.isArray(context?.claims) ? context.claims.map(compactClaim) : [],
  };
}

export type QuoteContractEntry = {
  claimId: string;
  canonicalText: string;
  label: string;
  speakerType: string;
  speakerName?: string;
};

export function buildQuoteContract(context: VerifiedEditorialContext | undefined): QuoteContractEntry[] {
  const quoteClaims = Array.isArray(context?.quoteClaims) ? context.quoteClaims : [];
  return quoteClaims.map((claim) => {
    const attribution = buildQuoteAttribution(claim);
    return {
      claimId: claim.id,
      canonicalText: claim.claim.trim(),
      label: attribution.label,
      speakerType: attribution.speakerType,
      speakerName: attribution.speakerName,
    };
  });
}

const QUOTE_RULE = `引语规则：任何 titles/blocks/cards/ValueModule 只要在 evidenceClaimIds 中引用 quote claim，就必须在该文本里原样出现 quoteContract 给出的 canonicalText 与 label（不得改写、截断、加书名号或换标点），并在 quoteAttributions 中原样抄写该条；character 不得写成作者本人，narrator 必须写成叙述者文本。没有 quote contract 条目时不得编造引语。`;

function writerPayload(input: WriterInput | undefined) {
  const valueModules = Array.isArray(input?.valueModules) ? input.valueModules : [];
  return {
    style: input?.style ?? null,
    brandRules: input?.brandRules ?? null,
    context: reduceContext(input?.context),
    valueModules,
    quoteContract: buildQuoteContract(input?.context),
    valueModuleClaimIds: [...new Set(valueModules.flatMap(({ evidenceClaimIds }) => evidenceClaimIds))],
    whyHerTodayClaimIds: input?.context?.whyHerToday?.evidenceClaimIds ?? [],
  };
}

function reviewPayload(input: EditorialReviewInput | undefined) {
  return {
    context: reduceContext(input?.context),
    valueModules: Array.isArray(input?.valueModules) ? input.valueModules : [],
    draft: input?.draft ?? null,
  };
}

function candidatePayload(input: unknown) {
  const record = asRecord(input);
  const tier = asString(record.tier) || "A";
  return {
    request: record.request,
    tier,
    tierRules: SELECTION_RULES[tier] ?? SELECTION_RULES.A,
  };
}

function extractionPayload(input: unknown) {
  const record = asRecord(input);
  const candidate = asRecord(record.candidate);
  const writer = asRecord(candidate.writer);
  const why = asRecord(candidate.proposedWhyHerToday);
  const leads = Array.isArray(why.evidenceLeads) ? why.evidenceLeads : [];
  const sources = Array.isArray(record.sources) ? record.sources : [];
  return {
    date: asString(record.date) || undefined,
    tier: why.tier,
    writer,
    proposedWhyHerToday: {
      relationType: why.relationType,
      relationDate: why.relationDate,
      tier: why.tier,
      isEditorialLink: why.isEditorialLink,
      shortReason: why.shortReason,
    },
    requiredLeadIds: leads.map((lead) => asString(asRecord(lead).id)).filter(Boolean),
    sourceIdList: sources.map((source) => asString(asRecord(source).sourceId)).filter(Boolean),
    sources,
    sourceTypeGuide: SOURCE_TYPE_GUIDE,
  };
}

function queryPayload(input: unknown) {
  const record = asRecord(input);
  const writer = asRecord(record.writer);
  const why = asRecord(record.whyHerToday);
  return { writer, whyHerToday: why };
}

const CANDIDATE_SYSTEM = `你是 HerLit 的女性文学选题编辑。HerLit 面向公众读者，每天介绍一位值得被今天讲述的女性作家。
${JSON_ONLY}

输出结构：
{"candidates":[{"id":"candidate-<slug>","writer":{"id":"writer-<slug>","name":"中文名","originalName":"原文名","birthDate":"YYYY-MM-DD","deathDate":"YYYY-MM-DD","knownFor":["作品名（首版年）"]},"proposedWhyHerToday":{"relationType":"birth|death|publication|award|life_event|month_link|seasonal_editorial_link","relationDate":"YYYY-MM-DD","tier":"A|B|C","isEditorialLink":false,"shortReason":"给普通读者的短理由","editorExplanation":"给编辑的完整说明","evidenceLeads":[{"id":"lead-1","description":"需要核验什么","expectedSourceType":"official|institution|library|publisher|reputable_media|secondary","searchHint":"检索式"}]},"signals":{"dateRelevance":0,"sourceAvailability":0,"recognition":0,"storyTension":0,"readerValue":0,"growthPotential":0,"herlitDistinctiveness":0},"editorialReason":"为什么她值得今天的篇幅","risks":["事实风险与待核验项"]}]}

硬约束：
- 只写你有把握真实存在的女性文学作者与真实作品；不确定的人物、日期、奖项一律不写。
- tier 必须等于输入 tier，并遵守输入中的 tierRules。
- 每位候选必须至少有 1 条 evidenceLeads；evidenceLeads 只是待核验线索，不得写成已核验事实。
- signals 七项都是 0–100 整数，诚实评估；禁止输出 score、weightedBase、weightedTotal、recentRepeatPenalty、rank 或任何总分。
- 本 tier 没有合适候选时返回 {"candidates":[]}，不要用弱候选或虚构人物补位。
- 优先选择存在官方档案、机构档案或出版社资料的作家，便于后续核验。
- 输入未指定人物时给出 3–5 位候选；指定 candidateWriter 时围绕该人物给出候选。`;

const QUERY_SYSTEM = `你是 HerLit 的资料检索编辑。目标是为指定女性作家找到可核验的一手或权威来源。
${JSON_ONLY}

输出结构：{"queries":["检索式 1","检索式 2"]}

硬约束：
- 3–4 条检索式，中文或英文皆可，覆盖：官方/机构档案、生卒日期与当日关系、代表作原名与首版年、奖项或重要事件。
- 检索式应包含人物原文名与关键年份，便于命中档案页；不要只写人物名。
- 不要以百科聚合站或语录站作为唯一目标。
- 不要输出 URL 猜测或伪造链接。`;

const EXTRACTION_SYSTEM = `你是 HerLit 的资料核验编辑。输入给出若干已实际抓取的 source（含 sourceId 与正文），你只做证据提取，不做润色、不写正文。
${JSON_ONLY}

输出结构：
{"sourceMetadata":[{"sourceId":"live-source-1","sourceType":"official|institution|library|publisher|reputable_media|secondary","title":"页面标题","publisher":"发布机构"}],"claims":[{"id":"claim-<slug>","claim":"一个可独立核验的事实，用陈述句","category":"bio|date_event|work|award|quote|relationship|context","evidence":[{"sourceId":"live-source-1","support":"direct|indirect|contradicts","locator":"页面中的位置（小标题/段落首句）","excerpt":"支撑该事实的原文片段","quoteSpeakerContext":{"speakerType":"author|narrator|character|other|unknown","speakerName":"","documentType":"work|letter|diary|speech|interview","workOrDocument":"","locator":""}}],"quoteContext":{"attributedSpeakerType":"author|narrator|character|other","attributedSpeakerName":""}}],"leadFindings":[{"evidenceLeadId":"lead-1","researchClaimIds":["claim-<slug>"],"emptyStatus":"needs_review|rejected","note":""}]}

硬约束：
- 只能使用输入 sources 正文里读得到的内容；不得用记忆、常识或搜索摘要补全。找不到就少写。
- 每条 claim 的 evidence.sourceId 必须来自输入的 sourceIdList；不得新建 sourceId。
- 每条输入 requiredLeadIds 必须恰好出现在 leadFindings 中一次。没有找到证据时 researchClaimIds 为空并给出 emptyStatus=needs_review（确认来源明确否定时才用 rejected）与 note。
- claim 一条只表达一个事实；日期关系必须单独一条 date_event，excerpt 中要含来源写明的日期原文。
- 作品类 claim 尽量带原名、首版年份、译者/版本信息（仅当来源写明）。
- category=quote 时：必须提供 quoteContext，并且至少一条 support=direct 的 evidence 同时带 excerpt（含引语完整原文措辞）与 quoteSpeakerContext（来源实际显示的说话者类型）。小说人物台词 speakerType=character，叙述者 narrator，只有来源明确为作者本人时才 author；无法确认就不要输出 quote claim。
- sourceType 按输入的 sourceTypeGuide 判断。
- 不要输出 verified、confidence、verificationStatus、verificationReason、readyForDraft 或任何分数。`;

const VALUE_SYSTEM = `你是 HerLit 的读者价值编辑。输入是程序从已核验资料构建的 VerifiedEditorialContext，你只能引用其中 claims 的 id。
${JSON_ONLY}

输出结构：
{"modules":[{"type":"where_to_start|reading_path|verified_quote|little_known_fact|women_connection|literary_history|work_context|today_connection","title":"","content":"","readerBenefit":"读者为什么值得收藏这条信息","evidenceClaimIds":["claim-id"],"quoteAttributions":[{"claimId":"","speakerType":"author|character|narrator|other","speakerName":"","label":""}]}]}

硬约束：
- 恰好 2–3 个模块，彼此互补，不要把同一事实换标题重复。
- evidenceClaimIds 只能引用输入 context.claims 中存在的 id。
- 类型与 claim 类别匹配：where_to_start/reading_path 必须引用 work claim；women_connection 必须引用 relationship 或 context；literary_history/work_context 必须引用 context 或 work；verified_quote 必须引用 quote claim；little_known_fact 不能只是出生日期等基本信息；today_connection 必须引用完全部 whyHerToday evidenceClaimIds。
- readerBenefit 必须具体（至少 8 个汉字），禁止“增加知识”“更了解作者”“内容很有价值”这类空话。
${QUOTE_RULE}
- 不搜索新事实、不写整篇正文；资料不足时宁可只给 2 个模块。`;

const WRITER_SYSTEM = `你是 HerLit 的小红书内容编辑。输入只有已核验上下文、通过校验的 Value Modules、风格与品牌规则；你不能搜索、不能新增事实、不能改写引语。
${JSON_ONLY}

输出结构：
{"titles":[{"text":"标题","angle":"角度","evidenceClaimIds":["claim-id"],"quoteAttributions":[{"claimId":"","speakerType":"author|character|narrator|other","speakerName":"","label":""}]}],"blocks":[{"id":"hook","role":"hook|why_today|story|meaning|value|interaction","text":"","evidenceClaimIds":["claim-id"]}],"hashtags":["#HerLit","#girltalk","#她文日历"],"cards":[{"order":1,"role":"cover|why_her_today|story|work|saveable_knowledge|reading_path|interaction","title":"","copy":"","visualDirection":"","evidenceClaimIds":["claim-id"]}],"readerHook":"","editorialAngle":""}

硬约束：
- titles 3–5 个，每个都必须引用至少 1 个已核验 claim id。
- blocks 必须包含且仅包含一个 role=why_today，其 evidenceClaimIds 必须包含 whyHerTodayClaimIds 的全部 id；hook 与 interaction 可以不引用 claim，其余 role 必须引用。
- role=value 的 block 只能引用 valueModuleClaimIds 中的 id，并自然嵌入 1–2 个 Value Module。
- cards 3–6 张，order 从 1 连续递增；必须有一张 role=why_her_today，且引用全部 whyHerTodayClaimIds。
- hashtags 必须包含 #HerLit #girltalk #她文日历，其他标签相关且克制，不得重复。
- 只写已核验 claim 支持的内容；不要输出 body、claims、sources、review、growthNotes 或 status 字段。
- 不写震惊体、虚假悬念、夸大经历，不写“女人一定要……”式规训；不把 editorial link 写成确切历史纪念日。
- 简体中文，短段落，克制、具体、有文学质感。姓名首次出现用中文名与原文名；作品保留原名与首版年份（仅限已核验信息）。
${QUOTE_RULE}`;

const REVIEW_SYSTEM = `你是独立于 Writer 的 HerLit 终稿前编辑审查员。你只输出审查结果，不得改写 claims、Value Modules、titles、blocks、cards 或 draft。
${JSON_ONLY}

输出结构：
{"growthNotes":{"clickReason":"","readThroughReason":"","saveReason":"","commentReason":"","followReason":""},"issues":[{"code":"unique-snake-code","severity":"warning|error","message":"","relatedIds":[""]}],"recommendation":"ready_for_human_review|needs_revision"}

硬约束：
- 五条 growthNotes 都必须是具体判断，每条至少 10 个汉字；followReason 必须解释读者为什么因此关注 HerLit，而不只是看完这一篇。
- 事实检查：姓名、日期、作品原名、首版年份、奖项、关系是否都有已核验 claim 支撑；是否把 editorial link 伪装成确切纪念日；引语是否被改写或错误归属。
- issues 的 code 唯一；存在 severity=error 时 recommendation 必须为 needs_revision。
- 不要输出 context、claims、sources、draft、titles、blocks、cards、fingerprint、revision 或 status。`;

function repairNotice(violations: readonly string[] | undefined): string {
  if (!violations?.length) return "";
  return `\n\n上一次输出违反了以下硬约束，请修正后重新输出完整 JSON（不要只输出补丁）：\n${violations
    .map((violation, index) => `${index + 1}. ${violation}`)
    .join("\n")}`;
}

export function buildTaskPrompt(
  task: ModelTask,
  input: unknown,
  violations?: readonly string[],
): PromptPair {
  const notice = repairNotice(violations);
  switch (task) {
    case "editorial_candidate_discovery":
      return { system: `${CANDIDATE_SYSTEM}${notice}`, user: JSON.stringify(candidatePayload(input)) };
    case "editorial_research_queries":
      return { system: `${QUERY_SYSTEM}${notice}`, user: JSON.stringify(queryPayload(input)) };
    case "editorial_claim_extraction":
      return { system: `${EXTRACTION_SYSTEM}${notice}`, user: JSON.stringify(extractionPayload(input)) };
    case "reader_value_modules": {
      const context = input as VerifiedEditorialContext | undefined;
      return {
        system: `${VALUE_SYSTEM}${notice}`,
        user: JSON.stringify({
          context: reduceContext(context),
          quoteContract: buildQuoteContract(context),
          whyHerTodayClaimIds: context?.whyHerToday?.evidenceClaimIds ?? [],
        }),
      };
    }
    case "grounded_editorial_draft":
      return { system: `${WRITER_SYSTEM}${notice}`, user: JSON.stringify(writerPayload(input as WriterInput | undefined)) };
    case "editorial_growth_review":
      return { system: `${REVIEW_SYSTEM}${notice}`, user: JSON.stringify(reviewPayload(input as EditorialReviewInput | undefined)) };
    default: {
      const exhaustive: never = task;
      throw new Error(`Unsupported editorial model task ${String(exhaustive)}`);
    }
  }
}

export function taskOutputBudget(task: ModelTask): number {
  switch (task) {
    case "editorial_research_queries":
      return 700;
    case "editorial_candidate_discovery":
      return 3_500;
    case "reader_value_modules":
      return 3_000;
    case "editorial_claim_extraction":
      return 8_000;
    case "grounded_editorial_draft":
      return 6_000;
    case "editorial_growth_review":
      return 2_000;
  }
}

export const SOURCE_TYPES: ReadonlySet<ResearchSourceType> = new Set<ResearchSourceType>([
  "official",
  "institution",
  "library",
  "publisher",
  "reputable_media",
  "secondary",
]);
