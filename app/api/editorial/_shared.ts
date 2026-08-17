import { OrchestrationError, asOrchestrationError } from "../../../lib/editorial-workbench/errors.ts";
import type { EditorialStage } from "../../../lib/editorial-workbench/types.ts";

export async function parseJson<T>(request: Request, stage: EditorialStage): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new OrchestrationError({ stage, code: "INVALID_JSON", message: "Request body must be valid JSON", retryable: false }, 400);
  }
}

export async function editorialRoute(
  stage: EditorialStage,
  action: () => Promise<unknown>,
): Promise<Response> {
  try {
    return Response.json(await action(), { status: 200 });
  } catch (error) {
    const normalized = asOrchestrationError(stage, error);
    return Response.json({ ok: false, error: normalized.toJSON() }, { status: normalized.status });
  }
}
