import assert from "node:assert/strict";
import test from "node:test";
import { assertDailyEditorialPackage } from "../lib/editorial-production/index.ts";
import { OrchestrationError } from "../lib/editorial-workbench/errors.ts";
import { createMockProviderFactory } from "../lib/editorial-workbench/providers.ts";
import { EditorialWorkbenchService } from "../lib/editorial-workbench/service.ts";
const DATE = "2026-08-17";
async function completeFlow() {
  const service = new EditorialWorkbenchService({ providers: createMockProviderFactory() });
  const candidates = await service.candidates({ date: DATE });
  const research = await service.research({ selectionId: candidates.meta.selectionId, candidateId: candidates.data.selectedCandidate.id });
  const production = await service.produce({ selectionId: candidates.meta.selectionId, researchId: research.meta.researchId });
  return { service, candidates, research, production };
}
test("Step 6: editor override preserves original ranking and binds production to the chosen writer", async () => {
  const service = new EditorialWorkbenchService({ providers: createMockProviderFactory() });
  const candidates = await service.candidates({ date: DATE });
  const originalIds = candidates.data.candidateShortlist.map(({ id }) => id);
  const alternative = candidates.data.candidateShortlist[1];
  await assert.rejects(
    () => service.research({ selectionId: candidates.meta.selectionId, candidateId: alternative.id }),
    (error: unknown) => error instanceof OrchestrationError && error.code === "EDITOR_OVERRIDE_REASON_REQUIRED",
  );
  const research = await service.research({
    selectionId: candidates.meta.selectionId,
    candidateId: alternative.id,
    overrideReason: "她更符合今天的人工编辑主题",
  });
  assert.equal(research.meta.editorOverride?.selectedCandidateId, alternative.id);
  const production = await service.produce({ selectionId: candidates.meta.selectionId, researchId: research.meta.researchId });
  assert.deepEqual(production.data.selection.candidateShortlist.map(({ id }) => id), originalIds);
  assert.equal(production.data.selection.selectedCandidate.id, originalIds[0]);
  assert.equal(production.data.editorOverride?.selectedCandidateId, alternative.id);
  assert.equal(production.data.researchAudit.writer.id, alternative.writer.id);
  assert.doesNotThrow(() => assertDailyEditorialPackage(production.data));
});

test("Step 6: opaque IDs resume the server-owned session within TTL", async () => {
  const { service, candidates, research, production } = await completeFlow();
  const resumed = await service.resume({
    selectionId: candidates.meta.selectionId,
    researchId: research.meta.researchId,
    packageId: production.meta.packageId,
  });
  assert.equal(resumed.data.stage, "production");
  assert.equal(resumed.data.productionMeta?.packageId, production.meta.packageId);
  assert.equal(resumed.data.editorialPackage?.status, "draft");
  assert.equal(resumed.data.humanReview.status, "ready_for_review");
});


test("resume rejects mismatched session relationships and malformed IDs", async () => {
  const { service, candidates, research, production } = await completeFlow();
  const other = await service.candidates({ date: DATE });
  await assert.rejects(() => service.resume({ selectionId: other.meta.selectionId, researchId: research.meta.researchId }), (error: unknown) => error instanceof OrchestrationError && error.code === "RESEARCH_SESSION_NOT_FOUND");
  await assert.rejects(() => service.resume({ selectionId: candidates.meta.selectionId, packageId: production.meta.packageId }), (error: unknown) => error instanceof OrchestrationError && error.code === "INVALID_SESSION_REQUEST");
});
test("resume returns server approval only for the current stored package", async () => {
  const { service, candidates, research, production } = await completeFlow();
  const ids = { selectionId: candidates.meta.selectionId, researchId: research.meta.researchId, packageId: production.meta.packageId };
  await service.approve({ packageId: ids.packageId });
  assert.equal((await service.resume(ids)).data.humanReview.status, "approved");
  await service.review({ packageId: ids.packageId, valueModules: production.data.valueModules, draft: production.data.draft });
  assert.equal((await service.resume(ids)).data.humanReview.status, "ready_for_review");
});
