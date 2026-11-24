import type { EditorialStage } from "./types.ts";
import { OrchestrationError } from "./errors.ts";

type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(task: string, stage: EditorialStage, message: string): never {
  throw new OrchestrationError({
    stage,
    code: "LIVE_PROVIDER_INVALID_RESPONSE",
    message: `${task}: ${message}`,
    retryable: false,
  }, 502);
}

function requireRecord(value: unknown, task: string, stage: EditorialStage): JsonRecord {
  if (!isRecord(value)) invalid(task, stage, "response must be an object");
  return value;
}

function requireArray(record: JsonRecord, key: string, task: string, stage: EditorialStage): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) invalid(task, stage, `${key} must be an array`);
  return value;
}

function requireString(value: unknown, task: string, stage: EditorialStage, label: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(task, stage, `${label} must be a non-empty string`);
  return value;
}

export function assertBasicLiveTaskPayload(task: string, value: unknown): void {
  const stage: EditorialStage = task === "editorial_candidate_discovery"
    ? "selection"
    : task === "editorial_research_queries" || task === "editorial_claim_extraction"
      ? "research"
      : task === "editorial_growth_review"
        ? "review"
        : "production";
  const record = requireRecord(value, task, stage);
  if (task === "editorial_candidate_discovery") {
    const signalKeys = ["dateRelevance", "sourceAvailability", "recognition", "storyTension", "readerValue", "growthPotential", "herlitDistinctiveness"];
    for (const [index, raw] of requireArray(record, "candidates", task, stage).entries()) {
      const candidate = requireRecord(raw, task, stage);
      requireString(candidate.id, task, stage, `candidates[${index}].id`);
      const writer = requireRecord(candidate.writer, task, stage);
      requireString(writer.id, task, stage, `candidates[${index}].writer.id`);
      requireString(writer.name, task, stage, `candidates[${index}].writer.name`);
      const why = requireRecord(candidate.proposedWhyHerToday, task, stage);
      const leads = requireArray(why, "evidenceLeads", task, stage);
      if (leads.length === 0) invalid(task, stage, `candidates[${index}] must include Evidence Leads`);
      for (const lead of leads) {
        const item = requireRecord(lead, task, stage);
        requireString(item.id, task, stage, "Evidence Lead id");
        requireString(item.description, task, stage, "Evidence Lead description");
      }
      if (Object.hasOwn(why, "evidenceClaimIds")) invalid(task, stage, "Selection cannot supply evidenceClaimIds");
      const signals = requireRecord(candidate.signals, task, stage);
      for (const key of signalKeys) {
        const signal = signals[key];
        if (typeof signal !== "number" || !Number.isFinite(signal) || signal < 0 || signal > 100) {
          invalid(task, stage, `candidates[${index}].signals.${key} must be between 0 and 100`);
        }
      }
      requireString(candidate.editorialReason, task, stage, `candidates[${index}].editorialReason`);
      if (!Array.isArray(candidate.risks) || candidate.risks.some((risk) => typeof risk !== "string")) {
        invalid(task, stage, `candidates[${index}].risks must be strings`);
      }
      for (const forbidden of ["score", "rank", "verified", "readyForDraft"]) {
        if (Object.hasOwn(candidate, forbidden)) invalid(task, stage, `provider cannot supply ${forbidden}`);
      }
    }
    return;
  }
  if (task === "editorial_research_queries") {
    const queries = requireArray(record, "queries", task, stage);
    if (queries.length === 0 || queries.some((query) => typeof query !== "string" || !query.trim())) {
      invalid(task, stage, "queries must contain non-empty strings");
    }
    return;
  }
  if (task === "editorial_claim_extraction") {
    for (const key of ["sourceMetadata", "claims", "leadFindings"]) requireArray(record, key, task, stage);
    for (const forbidden of ["verified", "readyForDraft", "verifiedWhyHerToday"]) {
      if (Object.hasOwn(record, forbidden)) invalid(task, stage, `provider cannot supply ${forbidden}`);
    }
    for (const raw of record.claims as unknown[]) {
      const claim = requireRecord(raw, task, stage);
      for (const forbidden of ["verified", "verificationStatus", "confidence"]) {
        if (Object.hasOwn(claim, forbidden)) invalid(task, stage, `provider claim cannot supply ${forbidden}`);
      }
    }
    return;
  }
  if (task === "reader_value_modules") {
    requireArray(record, "modules", task, stage);
    return;
  }
  if (task === "grounded_editorial_draft") {
    for (const key of ["titles", "blocks", "hashtags", "cards"]) requireArray(record, key, task, stage);
    if (record.status !== "draft") invalid(task, stage, "Writer status must be draft");
    return;
  }
  if (task === "editorial_growth_review") {
    requireRecord(record.growthNotes, task, stage);
    requireArray(record, "issues", task, stage);
    if (record.status !== "draft") invalid(task, stage, "Review status must be draft");
  }
}

export function assertExtractionReferences(
  value: unknown,
  allowedSourceIds: ReadonlySet<string>,
  allowedLeadIds: ReadonlySet<string>,
): void {
  const task = "editorial_claim_extraction";
  const stage = "research" as const;
  assertBasicLiveTaskPayload(task, value);
  const record = value as JsonRecord;
  for (const raw of record.sourceMetadata as unknown[]) {
    const item = requireRecord(raw, task, stage);
    const sourceId = requireString(item.sourceId, task, stage, "sourceMetadata.sourceId");
    if (!allowedSourceIds.has(sourceId)) invalid(task, stage, `unknown source ID ${sourceId}`);
  }
  for (const raw of record.claims as unknown[]) {
    const claim = requireRecord(raw, task, stage);
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : invalid(task, stage, "claim evidence must be an array");
    for (const rawEvidence of evidence) {
      const item = requireRecord(rawEvidence, task, stage);
      const sourceId = requireString(item.sourceId, task, stage, "claim evidence sourceId");
      if (!allowedSourceIds.has(sourceId)) invalid(task, stage, `claim references unknown source ID ${sourceId}`);
    }
  }
  for (const raw of record.leadFindings as unknown[]) {
    const finding = requireRecord(raw, task, stage);
    const leadId = requireString(finding.evidenceLeadId, task, stage, "leadFinding.evidenceLeadId");
    if (!allowedLeadIds.has(leadId)) invalid(task, stage, `unknown Evidence Lead ID ${leadId}`);
  }
}

export function parseSearchResults(value: unknown, label: string): Array<{ url: string; title: string; snippet?: string }> {
  const record = requireRecord(value, label, "research");
  const results = requireArray(record, "results", label, "research");
  return results.slice(0, 6).map((raw, index) => {
    const item = requireRecord(raw, label, "research");
    const url = requireString(item.url, label, "research", `results[${index}].url`);
    const title = requireString(item.title, label, "research", `results[${index}].title`);
    const snippet = typeof item.content === "string" ? item.content : typeof item.snippet === "string" ? item.snippet : undefined;
    return { url, title, ...(snippet ? { snippet } : {}) };
  });
}
