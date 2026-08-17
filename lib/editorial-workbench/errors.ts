import type { EditorialApiError, EditorialStage } from "./types.ts";

export class OrchestrationError extends Error {
  readonly stage: EditorialStage;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly status: number;

  constructor(error: EditorialApiError, status = 400) {
    super(error.message);
    this.name = "OrchestrationError";
    this.stage = error.stage;
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
    this.status = status;
  }

  toJSON(): EditorialApiError {
    return {
      stage: this.stage,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export function asOrchestrationError(
  stage: EditorialStage,
  error: unknown,
): OrchestrationError {
  if (error instanceof OrchestrationError) return error;
  const message = error instanceof Error ? error.message : "Unknown editorial error";
  if (/at least three qualified candidates/i.test(message)) {
    return new OrchestrationError({
      stage: "selection",
      code: "INSUFFICIENT_CANDIDATES",
      message,
      retryable: true,
    }, 422);
  }
  return new OrchestrationError({
    stage,
    code: stage === "production" ? "INVALID_EDITORIAL_PACKAGE" : "STAGE_FAILED",
    message,
    retryable: false,
  }, 422);
}
