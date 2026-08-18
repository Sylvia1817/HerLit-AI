import type {
  DailyEditorialPackage,
  EditorialRequest,
  EditorialSelectionResult,
  GroundedDraft,
  ResearchPack,
  ReviewedInputBinding,
  ValueModuleCollection,
} from "../../types/editorial.ts";

export type EditorialStage = "selection" | "research" | "production" | "review";
export type EditorialProviderMode = "mock" | "live";

export type EditorialApiError = {
  stage: EditorialStage;
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
};

export type ApiSuccess<TData, TMeta = Record<string, never>> = {
  ok: true;
  data: TData;
  meta: TMeta;
};

export type ApiFailure = { ok: false; error: EditorialApiError };

export type DiscoveryTraceEntry = {
  tier: "A" | "B" | "C";
  discovered: number;
};

export type CandidateApiMeta = {
  selectionId: string;
  providerMode: EditorialProviderMode;
  providerId: string;
  discoveryTrace: DiscoveryTraceEntry[];
};

export type ResearchApiMeta = {
  researchId: string;
  selectionId: string;
  providerMode: EditorialProviderMode;
};

export type ProductionApiMeta = {
  packageId: string;
  researchId: string;
  providerMode: EditorialProviderMode;
};

export type ReviewApiMeta = {
  packageId: string;
  providerMode: EditorialProviderMode;
};

export type ApprovalApiMeta = {
  packageId: string;
  providerMode: EditorialProviderMode;
};

export type CandidatesRequest = EditorialRequest;
export type CandidatesResponse = ApiSuccess<EditorialSelectionResult, CandidateApiMeta>;

export type ResearchRequest = {
  selectionId: string;
  selection: EditorialSelectionResult;
  candidateId: string;
};
export type ResearchResponse = ApiSuccess<ResearchPack, ResearchApiMeta>;

export type ProductionRequest = {
  selectionId: string;
  researchId: string;
  selection: EditorialSelectionResult;
  researchPack: ResearchPack;
  style?: string | null;
};
export type ProductionResponse = ApiSuccess<DailyEditorialPackage, ProductionApiMeta>;

export type ReviewRequest = {
  packageId: string;
  valueModules: ValueModuleCollection;
  draft: GroundedDraft;
};
export type ReviewResponse = ApiSuccess<DailyEditorialPackage, ReviewApiMeta>;

export type HumanReviewState =
  | { status: "editing" }
  | { status: "ready_for_review" }
  | HumanApproval;

export type HumanApproval = {
  status: "approved";
  packageId: string;
  reviewBinding: ReviewedInputBinding;
  approvedAt: string;
  approvedBy: "editor";
};

export type ApprovalRequest = { packageId: string };
export type ApprovalResponse = ApiSuccess<HumanApproval, ApprovalApiMeta>;

export type ExportRequest = {
  packageId: string;
  format: "markdown" | "json";
  preferredTitleIndex: number;
  publishReady: boolean;
};
export type ExportResponse = ApiSuccess<{
  content: string;
  contentType: "text/markdown" | "application/json";
  fileName: string;
}, ApprovalApiMeta>;

export type EditorialExportOptions = {
  preferredTitleIndex: number;
  publishReady: boolean;
};
