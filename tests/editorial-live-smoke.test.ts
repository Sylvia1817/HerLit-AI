import assert from "node:assert/strict";
import test from "node:test";

import { EditorialWorkbenchService } from "../lib/editorial-workbench/service.ts";

const enabled = process.env.EDITORIAL_LIVE_SMOKE === "1";

test("Step 6 opt-in live editorial smoke", { skip: !enabled }, async () => {
  const declaredBudget = Number(process.env.EDITORIAL_LIVE_SMOKE_MAX_USD ?? "1");
  assert.ok(Number.isFinite(declaredBudget) && declaredBudget > 0 && declaredBudget <= 1, "Live smoke declared budget must be within USD 1");
  assert.equal(process.env.EDITORIAL_PROVIDER_MODE, "live", "Live smoke requires EDITORIAL_PROVIDER_MODE=live");
  const date = process.env.EDITORIAL_LIVE_SMOKE_DATE ?? "2026-08-18";
  const service = new EditorialWorkbenchService();
  const candidates = await service.candidates({ date });
  assert.equal(candidates.meta.providerMode, "live");
  assert.ok(candidates.data.candidateShortlist.length >= 3 && candidates.data.candidateShortlist.length <= 5);
  const research = await service.research({
    selectionId: candidates.meta.selectionId,
    candidateId: candidates.data.selectedCandidate.id,
  });
  assert.equal(research.meta.providerMode, "live");
  assert.ok(research.data.sources.length > 0);
  assert.ok(research.data.sources.every(({ url }) => /^https?:\/\//.test(url)));
  if (!research.data.readyForDraft) {
    process.stdout.write(`Live smoke stopped correctly at verification for ${date}: ResearchPack not readyForDraft\n`);
    return;
  }
  const production = await service.produce({
    selectionId: candidates.meta.selectionId,
    researchId: research.meta.researchId,
  });
  assert.equal(production.data.status, "draft");
});
