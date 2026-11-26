/**
 * Deterministic normalization of live model payloads.
 *
 * Models are asked for a strict JSON contract, but a real provider will still
 * omit program-owned fields, reorder cards, drop required hashtags or invent a
 * source id. Everything here is a *repair* of machine-owned scaffolding:
 *
 * - program-owned values (hashtags, card order, quote attributions, status) are
 *   recomputed instead of trusted;
 * - citations are filtered to verified claims, never widened;
 * - anything that would require inventing editorial content is reported as a
 *   contract violation instead of being fabricated.
 *
 * Violations are fed back to the model for one repair attempt; the final
 * attempt is lenient so an editor still sees a diagnosable stage failure rather
 * than a transport crash.
 */

import type {
  CandidateSignals,
  ClaimEvidence,
  QuoteAttribution,
  QuoteSourceContext,
  ResearchClaimCategory,
  ResearchSourceType,
  VerifiedEditorialContext,
  VerifiedResearchClaim,
  WriterInput,
} from "../../../types/editorial.ts";
import { buildQuoteAttribution } from "../../editorial-production/grounding.ts";
import type {
  ExtractionPayloadLike,
  FindingLike,
  MetadataLike,
  ProposalLike,
} from "./payload-types.ts";
import { SOURCE_TYPES, TaskContractError } from "./tasks.ts";
import type { ModelTask } from "./tasks.ts";

const MAX_CANDIDATES = 5;
const MAX_QUERIES = 4;
const REQUIRED_HASHTAGS = ["#HerLit", "#girltalk", "#她文日历"] as const;

function isSourceType(value: string): value is ResearchSourceType {
  return (SOURCE_TYPES as ReadonlySet<string>).has(value);
}

const RELATION_TYPES = new Set([
  "birth",
  "death",
  "publication",
  "award",
  "life_event",
  "month_link",
  "seasonal_editorial_link",
]);

const TIER_A_RELATIONS = new Set(["birth", "death", "publication", "award", "life_event"]);

const SIGNAL_KEYS: ReadonlyArray<keyof CandidateSignals> = [
  "dateRelevance",
  "sourceAvailability",
  "recognition",
  "storyTension",
  "readerValue",
  "growthPotential",
  "herlitDistinctiveness",
];

const CLAIM_CATEGORIES = new Set<ResearchClaimCategory>([
  "bio",
  "date_event",
  "work",
  "award",
  "quote",
  "relationship",
  "context",
]);

const BLOCK_ROLES = new Set(["hook", "why_today", "story", "meaning", "value", "interaction"]);
const CARD_ROLES = new Set([
  "cover",
  "why_her_today",
  "story",
  "work",
  "saveable_knowledge",
  "reading_path",
  "interaction",
]);
const VALUE_TYPES = new Set([
  "where_to_start",
  "reading_path",
  "verified_quote",
  "little_known_fact",
  "women_connection",
  "literary_history",
  "work_context",
  "today_connection",
]);
const SPEAKER_TYPES = new Set(["author", "narrator", "character", "other", "unknown"]);
const DOCUMENT_TYPES = new Set(["work", "letter", "diary", "speech", "interview"]);
const SUPPORT_TYPES = new Set(["direct", "indirect", "contradicts"]);
const GROWTH_KEYS = ["clickReason", "readThroughReason", "saveReason", "commentReason", "followReason"] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized || undefined;
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundedScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function dateOrUndefined(value: unknown): string | undefined {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueIds(items: readonly { id: string }[], prefix: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id) item.id = `${prefix}-${seen.size + 1}`;
    let candidate = item.id;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${item.id}-${suffix}`;
      suffix += 1;
    }
    item.id = candidate;
    seen.add(candidate);
  }
}

/** Quote attributions are program-owned: never accept the model's copy. */
function attributionsFor(
  claimIds: readonly string[],
  quoteClaims: ReadonlyMap<string, VerifiedResearchClaim>,
): QuoteAttribution[] | undefined {
  const attributions = claimIds
    .map((claimId) => quoteClaims.get(claimId))
    .filter((claim): claim is VerifiedResearchClaim => Boolean(claim))
    .map((claim) => buildQuoteAttribution(claim));
  return attributions.length > 0 ? attributions : undefined;
}

function missingQuoteTexts(
  label: string,
  value: { text: string; evidenceClaimIds: readonly string[] },
  quoteClaims: ReadonlyMap<string, VerifiedResearchClaim>,
): string[] {
  return value.evidenceClaimIds
    .map((claimId) => quoteClaims.get(claimId))
    .filter((claim): claim is VerifiedResearchClaim => Boolean(claim))
    .flatMap((claim) => {
      const attribution = buildQuoteAttribution(claim);
      const problems: string[] = [];
      if (!value.text.includes(attribution.label)) {
        problems.push(`${label} 缺少引语归属标签「${attribution.label}」`);
      }
      if (!value.text.includes(claim.claim.trim())) {
        problems.push(`${label} 必须原样保留引语原文「${claim.claim.trim()}」`);
      }
      return problems;
    });
}

function normalizeCandidates(raw: unknown, input: unknown): { payload: unknown; violations: string[] } {
  const root = record(raw);
  if (!Array.isArray(root.candidates)) {
    throw new TaskContractError("editorial_candidate_discovery", ["响应必须是包含 candidates 数组的 JSON 对象"]);
  }
  const tier = text(record(input).tier) || "A";
  const violations: string[] = [];
  const candidates: unknown[] = [];

  for (const [index, item] of list(root.candidates).entries()) {
    const candidate = record(item);
    const writerRaw = record(candidate.writer);
    const name = text(writerRaw.name);
    if (!name) {
      violations.push(`第 ${index + 1} 位候选缺少 writer.name`);
      continue;
    }
    const why = record(candidate.proposedWhyHerToday);
    const relationType = text(why.relationType);
    if (!RELATION_TYPES.has(relationType)) {
      violations.push(`候选 ${name} 的 relationType「${relationType}」不在允许枚举内`);
      continue;
    }
    if (text(why.tier) !== tier) {
      violations.push(`候选 ${name} 返回 tier「${text(why.tier)}」，本次只接受 Tier ${tier}`);
      continue;
    }
    if (tier === "A" && !TIER_A_RELATIONS.has(relationType)) {
      violations.push(`Tier A 候选 ${name} 必须使用出生/去世/出版/获奖/人生事件关系`);
      continue;
    }

    const signals: Partial<Record<keyof CandidateSignals, number>> = {};
    for (const key of SIGNAL_KEYS) {
      const value = numeric(record(candidate.signals)[key]);
      if (value === undefined) {
        violations.push(`候选 ${name} 缺少 signals.${key}（0–100 整数）`);
      } else {
        signals[key] = boundedScore(value);
      }
    }
    if (SIGNAL_KEYS.some((key) => signals[key] === undefined)) continue;

    const leads = list(why.evidenceLeads)
      .map((lead, leadIndex) => {
        const entry = record(lead);
        const description = text(entry.description);
        if (!description) return undefined;
        const expectedSourceType = text(entry.expectedSourceType);
        return {
          id: text(entry.id) || `lead-${leadIndex + 1}`,
          description,
          ...(isSourceType(expectedSourceType) ? { expectedSourceType } : {}),
          ...(optionalText(entry.searchHint) ? { searchHint: optionalText(entry.searchHint)! } : {}),
        };
      })
      .filter((lead): lead is NonNullable<typeof lead> => Boolean(lead));
    if (leads.length === 0) {
      violations.push(`候选 ${name} 必须至少包含 1 条 evidenceLeads（description 非空）`);
      continue;
    }
    uniqueIds(leads, "lead");

    candidates.push({
      id: text(candidate.id) || `candidate-${slug(name, `candidate-${index + 1}`)}`,
      writer: {
        id: text(writerRaw.id) || `writer-${slug(name, `writer-${index + 1}`)}`,
        name,
        ...(optionalText(writerRaw.originalName) ? { originalName: optionalText(writerRaw.originalName)! } : {}),
        ...(dateOrUndefined(writerRaw.birthDate) ? { birthDate: dateOrUndefined(writerRaw.birthDate)! } : {}),
        ...(dateOrUndefined(writerRaw.deathDate) ? { deathDate: dateOrUndefined(writerRaw.deathDate)! } : {}),
        knownFor: uniqueStrings(list(writerRaw.knownFor).map((work) => text(work))).slice(0, 4),
      },
      proposedWhyHerToday: {
        relationType,
        ...(dateOrUndefined(why.relationDate) ? { relationDate: dateOrUndefined(why.relationDate)! } : {}),
        tier,
        // Tier C is an editorial link by definition; A/B are never editorial links.
        isEditorialLink: tier === "C",
        shortReason: text(why.shortReason) || text(candidate.editorialReason) || "编辑发现的待核验日期关联",
        editorExplanation: text(why.editorExplanation) || text(why.shortReason),
        evidenceLeads: leads,
      },
      signals,
      editorialReason: text(candidate.editorialReason) || text(why.shortReason),
      risks: list(candidate.risks).map((risk) => text(risk)).filter(Boolean),
    });
  }

  return { payload: { candidates: candidates.slice(0, MAX_CANDIDATES) }, violations };
}

function normalizeQueries(raw: unknown): { payload: unknown; violations: string[] } {
  const root = record(raw);
  if (!Array.isArray(root.queries)) {
    throw new TaskContractError("editorial_research_queries", ["响应必须是包含 queries 数组的 JSON 对象"]);
  }
  const queries = uniqueStrings(list(root.queries).map((query) => text(query)));
  const violations: string[] = [];
  if (queries.length === 0) violations.push("至少需要 1 条检索式");
  return { payload: { queries: queries.slice(0, MAX_QUERIES) }, violations };
}

function normalizeSpeakerContext(value: unknown): QuoteSourceContext | undefined {
  const entry = record(value);
  const speakerType = text(entry.speakerType);
  if (!SPEAKER_TYPES.has(speakerType)) return undefined;
  const documentType = text(entry.documentType);
  return {
    speakerType: speakerType as QuoteSourceContext["speakerType"],
    ...(optionalText(entry.speakerName) ? { speakerName: optionalText(entry.speakerName)! } : {}),
    ...(DOCUMENT_TYPES.has(documentType) ? { documentType: documentType as QuoteSourceContext["documentType"] } : {}),
    ...(optionalText(entry.workOrDocument) ? { workOrDocument: optionalText(entry.workOrDocument)! } : {}),
    ...(optionalText(entry.locator) ? { locator: optionalText(entry.locator)! } : {}),
  };
}

/**
 * Extraction is deliberately lenient: a thin research pack is a content outcome
 * the editor must see (needs_review/rejected claims), not a transport contract
 * failure that blocks the whole stage. Malformed items are dropped instead of
 * fabricated, and every Evidence Lead keeps exactly one resolution.
 */
function normalizeExtraction(raw: unknown, input: unknown): { payload: ExtractionPayloadLike; violations: string[] } {
  const root = record(raw);
  const violations: string[] = [];
  const inputRecord = record(input);
  const allowedSourceIds = new Set(
    list(inputRecord.sources)
      .map((source) => text(record(source).sourceId))
      .filter(Boolean),
  );
  const requiredLeadIds = list(record(record(inputRecord.candidate).proposedWhyHerToday).evidenceLeads)
    .map((lead) => text(record(lead).id))
    .filter(Boolean);

  const metadata: MetadataLike[] = [];
  for (const item of list(root.sourceMetadata)) {
    const entry = record(item);
    const sourceId = text(entry.sourceId);
    if (!sourceId || !allowedSourceIds.has(sourceId)) continue;
    const sourceType = text(entry.sourceType);
    metadata.push({
      sourceId,
      sourceType: isSourceType(sourceType) ? sourceType : "secondary",
      title: text(entry.title),
      ...(optionalText(entry.publisher) ? { publisher: optionalText(entry.publisher)! } : {}),
    });
  }

  const proposals: ProposalLike[] = [];
  for (const [index, item] of list(root.claims).entries()) {
    const claim = record(item);
    const claimText = text(claim.claim);
    const category = text(claim.category);
    if (!claimText) continue;
    if (!CLAIM_CATEGORIES.has(category as ResearchClaimCategory)) continue;
    const evidence: ClaimEvidence[] = [];
    for (const evidenceItem of list(claim.evidence)) {
      const entry = record(evidenceItem);
      const sourceId = text(entry.sourceId);
      if (!sourceId || !allowedSourceIds.has(sourceId)) continue;
      const support = text(entry.support);
      const speakerContext = normalizeSpeakerContext(entry.quoteSpeakerContext);
      evidence.push({
        sourceId,
        support: (SUPPORT_TYPES.has(support) ? support : "indirect") as ClaimEvidence["support"],
        ...(optionalText(entry.locator) ? { locator: optionalText(entry.locator)! } : {}),
        ...(optionalText(entry.excerpt) ? { excerpt: optionalText(entry.excerpt)! } : {}),
        ...(speakerContext ? { quoteSpeakerContext: speakerContext } : {}),
      });
    }

    const quoteContext = record(claim.quoteContext);
    const attributedSpeakerType = text(quoteContext.attributedSpeakerType);

    proposals.push({
      id: text(claim.id) || `claim-${index + 1}`,
      claim: claimText,
      category: category as ResearchClaimCategory,
      evidence,
      ...(category === "quote" && ["author", "narrator", "character", "other"].includes(attributedSpeakerType)
        ? {
            quoteContext: {
              attributedSpeakerType: attributedSpeakerType as NonNullable<ProposalLike["quoteContext"]>["attributedSpeakerType"],
              ...(optionalText(quoteContext.attributedSpeakerName)
                ? { attributedSpeakerName: optionalText(quoteContext.attributedSpeakerName)! }
                : {}),
            },
          }
        : {}),
    });
  }
  uniqueIds(proposals, "claim");

  const claimIdSet = new Set(proposals.map(({ id }) => id));
  const findings: FindingLike[] = [];
  const provided = new Map<string, Record<string, unknown>>();
  for (const item of list(root.leadFindings)) {
    const entry = record(item);
    const leadId = text(entry.evidenceLeadId);
    if (leadId && requiredLeadIds.includes(leadId) && !provided.has(leadId)) provided.set(leadId, entry);
  }
  for (const leadId of requiredLeadIds) {
    const entry = provided.get(leadId);
    const claimIds = uniqueStrings(list(entry?.researchClaimIds).map((id) => text(id)).filter((id) => claimIdSet.has(id)));
    findings.push({
      evidenceLeadId: leadId,
      researchClaimIds: claimIds,
      ...(claimIds.length === 0
        ? { emptyStatus: text(entry?.emptyStatus) === "rejected" ? "rejected" : "needs_review" }
        : {}),
      note: optionalText(entry?.note) ?? (entry ? undefined : "模型未解析该 Evidence Lead"),
    });
  }

  return { payload: { sourceMetadata: metadata, claims: proposals, leadFindings: findings }, violations };
}

function normalizeValueModules(raw: unknown, input: unknown): { payload: unknown; violations: string[] } {
  const root = record(raw);
  if (!Array.isArray(root.modules)) {
    throw new TaskContractError("reader_value_modules", ["响应必须是包含 modules 数组的 JSON 对象"]);
  }
  const context = input as VerifiedEditorialContext;
  const claimIds = new Set(context.claims.map(({ id }) => id));
  const quoteClaims = new Map(
    context.claims.filter(({ category }) => category === "quote").map((claim) => [claim.id, claim]),
  );
  const violations: string[] = [];
  const modules: unknown[] = [];

  for (const [index, item] of list(root.modules).entries()) {
    const candidate = record(item);
    const type = text(candidate.type);
    if (!VALUE_TYPES.has(type)) {
      violations.push(`第 ${index + 1} 个模块的 type「${type}」不在允许枚举内`);
      continue;
    }
    const title = text(candidate.title);
    const content = text(candidate.content);
    const readerBenefit = text(candidate.readerBenefit);
    if (!title || !content) {
      violations.push(`模块 ${type} 必须包含 title 与 content`);
      continue;
    }
    if (readerBenefit.length < 8) {
      violations.push(`模块 ${type} 的 readerBenefit 太短，必须说明读者为什么值得收藏`);
    }
    const cited = uniqueStrings(list(candidate.evidenceClaimIds).map((id) => text(id)).filter((id) => claimIds.has(id)));
    if (cited.length === 0) {
      violations.push(`模块 ${type} 必须至少引用 1 个已核验 claim id`);
      continue;
    }
    violations.push(...missingQuoteTexts(`模块 ${type}`, { text: content, evidenceClaimIds: cited }, quoteClaims));
    const attributions = attributionsFor(cited, quoteClaims);
    modules.push({
      type,
      title,
      content,
      readerBenefit,
      evidenceClaimIds: cited,
      ...(attributions ? { quoteAttributions: attributions } : {}),
    });
  }

  if (modules.length < 2) violations.push("必须给出 2–3 个 Value Module");
  return { payload: { modules: modules.slice(0, 3) }, violations };
}

function normalizeWriter(raw: unknown, input: unknown): { payload: unknown; violations: string[] } {
  const root = record(raw);
  const writerInput = input as WriterInput;
  const { context, valueModules } = writerInput;
  const claimIds = new Set(context.claims.map(({ id }) => id));
  const quoteClaims = new Map(
    context.claims.filter(({ category }) => category === "quote").map((claim) => [claim.id, claim]),
  );
  const whyIds = context.whyHerToday.evidenceClaimIds;
  const moduleClaimIds = new Set(valueModules.flatMap(({ evidenceClaimIds }) => evidenceClaimIds));
  const violations: string[] = [];

  const cite = (value: unknown): string[] =>
    uniqueStrings(list(value).map((id) => text(id)).filter((id) => claimIds.has(id)));

  const titles = list(root.titles).flatMap((item, index) => {
    const title = record(item);
    const titleText = text(title.text);
    if (!titleText) {
      violations.push(`第 ${index + 1} 个标题缺少 text`);
      return [];
    }
    const evidenceClaimIds = cite(title.evidenceClaimIds);
    if (evidenceClaimIds.length === 0) {
      violations.push(`标题「${titleText.slice(0, 20)}」必须引用至少 1 个已核验 claim id`);
      return [];
    }
    violations.push(...missingQuoteTexts(`标题「${titleText.slice(0, 20)}」`, { text: titleText, evidenceClaimIds }, quoteClaims));
    const attributions = attributionsFor(evidenceClaimIds, quoteClaims);
    return [{
      text: titleText,
      angle: text(title.angle) || "内容角度",
      evidenceClaimIds,
      ...(attributions ? { quoteAttributions: attributions } : {}),
    }];
  });

  const blocks = list(root.blocks).flatMap((item, index) => {
    const block = record(item);
    const role = text(block.role);
    if (!BLOCK_ROLES.has(role)) {
      violations.push(`第 ${index + 1} 个 block 的 role「${role}」不在允许枚举内`);
      return [];
    }
    const blockText = text(block.text);
    if (!blockText) {
      violations.push(`block ${role} 缺少 text`);
      return [];
    }
    let evidenceClaimIds = cite(block.evidenceClaimIds);
    if (role === "why_today") {
      evidenceClaimIds = uniqueStrings([...evidenceClaimIds, ...whyIds]);
    }
    if (role === "value") {
      const allowed = evidenceClaimIds.filter((id) => moduleClaimIds.has(id));
      if (allowed.length === 0) {
        violations.push("role=value 的 block 必须引用 Value Module 中出现的 claim id");
      }
      evidenceClaimIds = allowed;
    }
    if (role !== "hook" && role !== "interaction" && evidenceClaimIds.length === 0) {
      violations.push(`事实性 block ${role} 必须引用已核验 claim id`);
    }
    violations.push(...missingQuoteTexts(`block ${role}`, { text: blockText, evidenceClaimIds }, quoteClaims));
    const attributions = attributionsFor(evidenceClaimIds, quoteClaims);
    return [{
      id: text(block.id) || `${role}-${index + 1}`,
      role,
      text: blockText,
      evidenceClaimIds,
      ...(attributions ? { quoteAttributions: attributions } : {}),
    }];
  });
  uniqueIds(blocks, "block");

  const whyTodayBlocks = blocks.filter((block) => block.role === "why_today");
  if (whyTodayBlocks.length === 0) {
    violations.push("blocks 必须包含一个 role=why_today 的段落");
  }
  for (const extra of whyTodayBlocks.slice(1)) extra.role = "story";

  const hashtags = uniqueStrings(
    [...REQUIRED_HASHTAGS, ...list(root.hashtags).map((tag) => {
      const value = text(tag);
      return value && !value.startsWith("#") ? `#${value}` : value;
    })],
  );

  const cards = list(root.cards).flatMap((item, index) => {
    const card = record(item);
    const role = text(card.role);
    if (!CARD_ROLES.has(role)) {
      violations.push(`第 ${index + 1} 张卡片的 role「${role}」不在允许枚举内`);
      return [];
    }
    const title = text(card.title);
    const copy = text(card.copy);
    if (!title || !copy) {
      violations.push(`卡片 ${role} 必须包含 title 与 copy`);
      return [];
    }
    let evidenceClaimIds = cite(card.evidenceClaimIds);
    if (role === "why_her_today") {
      evidenceClaimIds = uniqueStrings([...evidenceClaimIds, ...whyIds]);
    }
    if (role !== "cover" && role !== "interaction" && evidenceClaimIds.length === 0) {
      violations.push(`事实性卡片 ${role} 必须引用已核验 claim id`);
    }
    violations.push(...missingQuoteTexts(`卡片 ${role}`, { text: `${title}\n${copy}`, evidenceClaimIds }, quoteClaims));
    const attributions = attributionsFor(evidenceClaimIds, quoteClaims);
    return [{
      order: index + 1,
      role,
      title,
      copy,
      visualDirection: text(card.visualDirection) || "深墨绿与暖象牙底色，朱红点缀，中文标题使用确定性排版",
      evidenceClaimIds,
      ...(attributions ? { quoteAttributions: attributions } : {}),
    }];
  });

  if (cards.length < 3) violations.push("卡片必须为 3–6 张");
  if (!cards.some(({ role }) => role === "why_her_today")) {
    violations.push("卡片必须包含一张 role=why_her_today");
  }
  if (titles.length < 3) violations.push("标题必须为 3–5 个");

  return {
    payload: {
      titles: titles.slice(0, 5),
      blocks,
      hashtags,
      cards: cards.slice(0, 6),
      readerHook: text(root.readerHook) || context.whyHerToday.shortReason,
      editorialAngle: text(root.editorialAngle) || context.whyHerToday.shortReason,
      status: "draft",
    },
    violations,
  };
}

function normalizeReview(raw: unknown): { payload: unknown; violations: string[] } {
  const root = record(raw);
  const violations: string[] = [];
  const notes = record(root.growthNotes);
  const growthNotes = Object.fromEntries(
    GROWTH_KEYS.map((key) => {
      const value = text(notes[key]);
      if (value.length < 10) violations.push(`growthNotes.${key} 必须给出具体判断（至少 10 个汉字）`);
      return [key, value];
    }),
  ) as Record<(typeof GROWTH_KEYS)[number], string>;

  const issues: Array<{ code: string; severity: "warning" | "error"; message: string; relatedIds?: string[] }> = [];
  const codes = new Set<string>();
  for (const [index, item] of list(root.issues).entries()) {
    const issue = record(item);
    const message = text(issue.message);
    if (!message) continue;
    let code = text(issue.code) || `issue-${index + 1}`;
    let suffix = 2;
    while (codes.has(code)) {
      code = `${code}-${suffix}`;
      suffix += 1;
    }
    codes.add(code);
    const relatedIds = uniqueStrings(list(issue.relatedIds).map((id) => text(id)));
    issues.push({
      code,
      severity: text(issue.severity) === "error" ? "error" : "warning",
      message,
      ...(relatedIds.length > 0 ? { relatedIds } : {}),
    });
  }

  let recommendation = text(root.recommendation);
  if (recommendation !== "ready_for_human_review" && recommendation !== "needs_revision") {
    violations.push("recommendation 只能是 ready_for_human_review 或 needs_revision");
    recommendation = "needs_revision";
  }
  if (recommendation === "ready_for_human_review" && issues.some(({ severity }) => severity === "error")) {
    recommendation = "needs_revision";
  }

  return {
    payload: { growthNotes, issues, recommendation, status: "draft" },
    violations,
  };
}

/**
 * Normalize a model payload into the task contract.
 *
 * Deterministic program-owned repairs (hashtags, card order, quote
 * attributions, tier semantics, dropped fake sources) never throw. Content
 * defects an editor cannot accept — missing titles, a fact block without
 * evidence, a missing Why Her Today card — throw so the adapter can ask the
 * model once more, then fail with a diagnosable stage error.
 */
export function normalizeTaskPayload(task: ModelTask, raw: unknown, input: unknown): unknown {
  const normalize = (): { payload: unknown; violations: string[] } => {
    switch (task) {
      case "editorial_candidate_discovery":
        return normalizeCandidates(raw, input);
      case "editorial_research_queries":
        return normalizeQueries(raw);
      case "editorial_claim_extraction":
        return normalizeExtraction(raw, input);
      case "reader_value_modules":
        return normalizeValueModules(raw, input);
      case "grounded_editorial_draft":
        return normalizeWriter(raw, input);
      case "editorial_growth_review":
        return normalizeReview(raw);
    }
  };
  const { payload, violations } = normalize();
  if (violations.length > 0) throw new TaskContractError(task, violations);
  return payload;
}

