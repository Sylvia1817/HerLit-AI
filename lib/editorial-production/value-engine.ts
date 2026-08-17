import type {
  ValueModule,
  ValueModuleCollection,
  ValueModuleType,
  VerifiedEditorialContext,
  VerifiedResearchClaim,
} from "../../types/editorial.ts";
import type { ReaderValueProvider } from "./contracts.ts";
import { assertVerifiedEditorialContext } from "./context.ts";
import {
  assertGroundedClaimIds,
  assertQuoteGrounding,
  verifiedClaimMap,
} from "./grounding.ts";

const VALUE_MODULE_TYPES = new Set<ValueModuleType>([
  "where_to_start",
  "reading_path",
  "verified_quote",
  "little_known_fact",
  "women_connection",
  "literary_history",
  "work_context",
  "today_connection",
]);

const GENERIC_BENEFITS = [
  "增加知识",
  "更了解作者",
  "更加了解作者",
  "帮助了解作者",
  "内容很有价值",
];

function hasCategory(
  claims: readonly VerifiedResearchClaim[],
  categories: readonly VerifiedResearchClaim["category"][],
): boolean {
  return claims.some(({ category }) => categories.includes(category));
}

function assertReaderBenefit(valueModule: ValueModule): void {
  const normalized = valueModule.readerBenefit.trim();
  if (normalized.length < 8) {
    throw new Error(`${valueModule.type} readerBenefit must be concrete`);
  }
  if (GENERIC_BENEFITS.some((phrase) => normalized.includes(phrase))) {
    throw new Error(`${valueModule.type} readerBenefit is too generic`);
  }
}

export function assertValueModules(
  modules: readonly ValueModule[],
  context: VerifiedEditorialContext,
): asserts modules is ValueModuleCollection {
  assertVerifiedEditorialContext(context);
  if (modules.length < 2 || modules.length > 3) {
    throw new Error("ValueModuleCollection must contain 2–3 modules");
  }
  const claimsById = verifiedClaimMap(context.claims);

  for (const valueModule of modules) {
    if (!VALUE_MODULE_TYPES.has(valueModule.type)) {
      throw new Error(`Unknown ValueModule type ${valueModule.type}`);
    }
    if (!valueModule.title.trim() || !valueModule.content.trim()) {
      throw new Error(`${valueModule.type} must include title and content`);
    }
    if (valueModule.evidenceClaimIds.length === 0) {
      throw new Error(`${valueModule.type} must cite at least one verified claim`);
    }
    assertGroundedClaimIds(
      `ValueModule ${valueModule.type}`,
      valueModule.evidenceClaimIds,
      claimsById,
    );
    assertReaderBenefit(valueModule);

    const citedClaims = valueModule.evidenceClaimIds.map(
      (claimId) => claimsById.get(claimId)!,
    );
    if (
      (valueModule.type === "where_to_start" || valueModule.type === "reading_path") &&
      !hasCategory(citedClaims, ["work"])
    ) {
      throw new Error(`${valueModule.type} must cite a verified work claim`);
    }
    if (
      valueModule.type === "little_known_fact" &&
      !hasCategory(citedClaims, ["work", "award", "relationship", "context"])
    ) {
      throw new Error(
        "little_known_fact cannot repackage only basic bio/date facts",
      );
    }
    if (
      valueModule.type === "women_connection" &&
      !hasCategory(citedClaims, ["relationship", "context"])
    ) {
      throw new Error(
        "women_connection must cite relationship or context claims",
      );
    }
    if (
      valueModule.type === "literary_history" &&
      !hasCategory(citedClaims, ["context", "work"])
    ) {
      throw new Error("literary_history must cite context or work claims");
    }
    if (
      valueModule.type === "work_context" &&
      !hasCategory(citedClaims, ["context", "work"])
    ) {
      throw new Error("work_context must cite context or work claims");
    }
    if (
      valueModule.type === "verified_quote" &&
      !hasCategory(citedClaims, ["quote"])
    ) {
      throw new Error("verified_quote must cite a verified quote claim");
    }
    if (
      valueModule.type === "today_connection" &&
      !context.whyHerToday.evidenceClaimIds.every((claimId) =>
        valueModule.evidenceClaimIds.includes(claimId),
      )
    ) {
      throw new Error("today_connection must cite Why Her Today evidence");
    }

    assertQuoteGrounding(
      `ValueModule ${valueModule.type}`,
      valueModule.content,
      valueModule.evidenceClaimIds,
      valueModule.quoteAttributions,
      claimsById,
    );
  }
}

export class ReaderValueEngine {
  private readonly provider: ReaderValueProvider;

  constructor(provider: ReaderValueProvider) {
    this.provider = provider;
  }

  async create(
    context: VerifiedEditorialContext,
  ): Promise<ValueModuleCollection> {
    assertVerifiedEditorialContext(context);
    const proposals = structuredClone([
      ...(await this.provider.propose(structuredClone(context))),
    ]);
    assertValueModules(proposals, context);
    return proposals;
  }
}
