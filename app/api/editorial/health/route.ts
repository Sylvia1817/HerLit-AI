import { describeEditorialRuntime } from "../../../../lib/editorial-workbench/diagnostics.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only provider readiness for the workbench header.
 * Reports configuration shape only — never keys, query strings or upstream bodies.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    { ok: true, data: describeEditorialRuntime() },
    { headers: { "cache-control": "no-store" } },
  );
}
