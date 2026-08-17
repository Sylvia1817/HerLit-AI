import type { ResearchRequest } from "../../../../lib/editorial-workbench/types.ts";
import { getEditorialWorkbenchService } from "../../../../lib/editorial-workbench/service.ts";
import { editorialRoute, parseJson } from "../_shared.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return editorialRoute("research", async () => {
    const input = await parseJson<ResearchRequest>(request, "research");
    return getEditorialWorkbenchService().research(input);
  });
}
