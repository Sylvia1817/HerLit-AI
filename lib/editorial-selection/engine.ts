import type {
  Candidate,
  CandidateShortlist,
  CandidateSignals,
  DateRelevanceTier,
  EditorialRequest,
  EditorialSelectionResult,
  RelationType,
  SelectionDecision,
} from "../../types/editorial.ts";
import {
  CANDIDATE_QUALIFICATION,
  EDITORIAL_HISTORY_WINDOW_DAYS,
  TIER_ORDER,
} from "./constants.ts";
import type {
  CandidateProposal,
  EditorialCandidateProvider,
  EditorialHistoryProvider,
} from "./contracts.ts";
import {
  calculateRecentRepeatPenalty,
  daysBetweenDateOnly,
} from "./history.ts";
import {
  calculateCandidateScore,
  isQualifiedCandidate,
  rankCandidates,
} from "./scoring.ts";

const TIER_A_RELATIONS = new Set<RelationType>([
  "birth",
  "death",
  "publication",
  "award",
  "life_event",
]);

const SIGNAL_LABELS: Record<keyof CandidateSignals, string> = {
  dateRelevance: "日期关联",
  sourceAvailability: "优质来源可得性",
  recognition: "大众认知",
  storyTension: "故事张力",
  readerValue: "收藏价值",
  growthPotential: "传播潜力",
  herlitDistinctiveness: "HerLit 独特性",
};

function assertProposal(
  proposal: CandidateProposal,
  requestedTier: DateRelevanceTier,
  provider: EditorialCandidateProvider,
): void {
  const why = proposal.proposedWhyHerToday;

  if (why.tier !== requestedTier) {
    throw new Error(
      `Candidate ${proposal.id} returned tier ${why.tier} during Tier ${requestedTier}`,
    );
  }
  if (why.evidenceLeads.length === 0) {
    throw new Error(`Candidate ${proposal.id} must include Evidence Leads`);
  }
  if (requestedTier === "C" && !why.isEditorialLink) {
    throw new Error(`Tier C candidate ${proposal.id} must be an editorial link`);
  }
  if (requestedTier !== "C" && why.isEditorialLink) {
    throw new Error(
      `Tier ${requestedTier} candidate ${proposal.id} cannot be marked as an editorial link`,
    );
  }
  if (requestedTier === "A" && !TIER_A_RELATIONS.has(why.relationType)) {
    throw new Error(
      `Tier A candidate ${proposal.id} has invalid relation ${why.relationType}`,
    );
  }
  if (
    proposal.provenance.providerId !== provider.id ||
    proposal.provenance.providerMode !== provider.mode
  ) {
    throw new Error(`Candidate ${proposal.id} has inconsistent provider provenance`);
  }
}

function toCandidateShortlist(candidates: Candidate[]): CandidateShortlist {
  if (candidates.length < 3 || candidates.length > 5) {
    throw new Error("Candidate shortlist must contain between 3 and 5 candidates");
  }
  return candidates as CandidateShortlist;
}

function describeTradeOff(
  selected: Candidate,
  alternative: Candidate,
): string {
  const reasons: string[] = [];

  if (alternative.score.recentRepeatPenalty > selected.score.recentRepeatPenalty) {
    reasons.push(
      `近期重复扣分 ${alternative.score.recentRepeatPenalty}，降低了本次优先级`,
    );
  }

  const strongerSelectedSignals = (
    Object.keys(SIGNAL_LABELS) as Array<keyof CandidateSignals>
  )
    .map((key) => ({
      key,
      gap: selected.signals[key] - alternative.signals[key],
    }))
    .filter(({ gap }) => gap >= 8)
    .sort((left, right) => right.gap - left.gap)
    .slice(0, 2);

  for (const { key } of strongerSelectedSignals) {
    reasons.push(`${SIGNAL_LABELS[key]}不及 Today's Pick`);
  }

  if (reasons.length === 0) {
    reasons.push(
      `在确定性权重下，日期关联、读者价值与品牌独特性的综合取舍较弱`,
    );
  }

  return `${alternative.writer.name}：${reasons.join("；")}。`;
}

function buildSelectionDecision(
  shortlist: CandidateShortlist,
): SelectionDecision {
  const selected = shortlist[0];

  return {
    selectedCandidateId: selected.id,
    whySelected: `${selected.editorialReason}；程序评分显示她在日期关联、读者价值与 HerLit 独特性之间形成了本次最强的编辑组合。`,
    whyNotOthers: shortlist.slice(1).map((candidate) => ({
      candidateId: candidate.id,
      reason: describeTradeOff(selected, candidate),
    })),
  };
}

export function assertSelectionResult(
  result: EditorialSelectionResult,
): asserts result is EditorialSelectionResult {
  const shortlist = result.candidateShortlist;

  if (shortlist.length < 3 || shortlist.length > 5) {
    throw new Error("Selection result must contain 3–5 candidates");
  }
  const candidateIds = shortlist.map(({ id }) => id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Candidate shortlist must contain unique candidate IDs");
  }
  shortlist.forEach((candidate, index) => {
    if (!isQualifiedCandidate(candidate)) {
      throw new Error(`Candidate ${candidate.id} does not meet qualification gates`);
    }
    if (candidate.rank !== index + 1) {
      throw new Error(`Candidate ${candidate.id} has an invalid rank`);
    }
    if (
      index > 0 &&
      shortlist[index - 1].score.weightedTotal < candidate.score.weightedTotal
    ) {
      throw new Error("Candidate shortlist is not sorted by weightedTotal");
    }
  });

  const selectedCandidateId = result.selectionDecision.selectedCandidateId;
  if (
    selectedCandidateId !== result.selectedCandidate.id ||
    selectedCandidateId !== shortlist[0].id
  ) {
    throw new Error(
      "selectedCandidateId, selectedCandidate.id and candidateShortlist[0].id must match",
    );
  }
  if (
    shortlist.filter(({ id }) => id === selectedCandidateId).length !== 1
  ) {
    throw new Error("Selected candidate ID must occur exactly once in shortlist");
  }
  if (result.selectedCandidate.rank !== 1 || shortlist[0].rank !== 1) {
    throw new Error("Selected candidate must have rank 1");
  }

  const expectedAlternatives = new Set(shortlist.slice(1).map(({ id }) => id));
  const explainedAlternatives = new Set(
    result.selectionDecision.whyNotOthers.map(({ candidateId }) => candidateId),
  );
  if (
    expectedAlternatives.size !== explainedAlternatives.size ||
    [...expectedAlternatives].some((id) => !explainedAlternatives.has(id))
  ) {
    throw new Error("SelectionDecision must explain every non-selected candidate");
  }
}

export class DailyEditorialSelectionEngine {
  private readonly candidateProvider: EditorialCandidateProvider;
  private readonly historyProvider: EditorialHistoryProvider;

  constructor(
    candidateProvider: EditorialCandidateProvider,
    historyProvider: EditorialHistoryProvider,
  ) {
    this.candidateProvider = candidateProvider;
    this.historyProvider = historyProvider;
  }

  async select(request: EditorialRequest): Promise<EditorialSelectionResult> {
    daysBetweenDateOnly(request.date, request.date);

    const history = await this.historyProvider.listRecentEntries(
      request.date,
      EDITORIAL_HISTORY_WINDOW_DAYS,
    );
    const excludedWriterIds = new Set(request.excludeWriterIds ?? []);
    const proposalsByWriter = new Map<string, CandidateProposal>();
    let candidates: Candidate[] = [];

    for (const tier of TIER_ORDER) {
      const discovered = await this.candidateProvider.discover(request, tier);

      for (const proposal of discovered) {
        if (excludedWriterIds.has(proposal.writer.id)) {
          continue;
        }
        assertProposal(proposal, tier, this.candidateProvider);
        if (!proposalsByWriter.has(proposal.writer.id)) {
          proposalsByWriter.set(proposal.writer.id, proposal);
        }
      }

      candidates = [...proposalsByWriter.values()].map((proposal) => {
        const recentRepeatPenalty = calculateRecentRepeatPenalty(
          proposal.writer.id,
          request.date,
          history,
        );

        return {
          ...proposal,
          score: calculateCandidateScore(
            proposal.signals,
            recentRepeatPenalty,
          ),
          rank: 0,
        };
      });

      const qualifiedCount = candidates.filter(isQualifiedCandidate).length;
      if (
        qualifiedCount >= CANDIDATE_QUALIFICATION.minQualifiedCandidates
      ) {
        break;
      }
    }

    const qualifiedCandidates = candidates.filter(isQualifiedCandidate);
    if (
      qualifiedCandidates.length <
      CANDIDATE_QUALIFICATION.minQualifiedCandidates
    ) {
      throw new Error(
        "Selection requires at least three qualified candidates after Tier C",
      );
    }

    const ranked = rankCandidates(qualifiedCandidates);
    const candidateShortlist = toCandidateShortlist(ranked.slice(0, 5));
    const selectionDecision = buildSelectionDecision(candidateShortlist);
    const result: EditorialSelectionResult = {
      date: request.date,
      candidateShortlist,
      selectionDecision,
      selectedCandidate: candidateShortlist[0],
    };

    assertSelectionResult(result);
    return result;
  }
}
