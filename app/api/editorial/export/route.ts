import type { ExportRequest } from "../../../../lib/editorial-workbench/types.ts";
import { getEditorialWorkbenchService } from "../../../../lib/editorial-workbench/service.ts";
import { editorialRoute, parseJson } from "../_shared.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return editorialRoute("review", async () => {
    const input = await parseJson<ExportRequest>(request, "review");
    return getEditorialWorkbenchService().export(input);
  });
}
