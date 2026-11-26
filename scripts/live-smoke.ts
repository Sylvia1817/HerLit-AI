/**
 * Live pipeline smoke run.
 *
 * Exercises the real production path through the configured live providers:
 * date → candidates → research → reader value → grounded draft → review.
 * It never publishes anywhere and never approves a package.
 *
 *   npm run smoke:live -- --date 2026-11-02
 *
 * Requires EDITORIAL_PROVIDER_MODE=live plus the model/search settings from
 * .env.example. Results are written to `runtime/` (git-ignored) for inspection.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getEditorialDate } from "../lib/editorial-workbench/date.ts";
import { describeEditorialRuntime } from "../lib/editorial-workbench/diagnostics.ts";
import { EditorialWorkbenchService } from "../lib/editorial-workbench/service.ts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function line(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(18, " ")} ${value}`);
}

async function main(): Promise<void> {
  const date = argument("date") ?? getEditorialDate();
  const outDir = resolve("runtime");
  const diagnostics = describeEditorialRuntime();

  console.log(`\nHerLit live smoke · ${date}`);
  line("provider mode", diagnostics.mode);
  if (diagnostics.mode === "live") {
    if (!diagnostics.ready) {
      line("配置缺失", diagnostics.missing.join(", ") || "-");
      for (const issue of diagnostics.issues) console.log(`  ${issue.code}: ${issue.message}`);
      process.exitCode = 2;
      return;
    }
    line("model", `${diagnostics.model?.protocol} · ${diagnostics.model?.model} @ ${diagnostics.model?.host}`);
    line("search", `${diagnostics.search?.protocol} @ ${diagnostics.search?.host}`);
  } else {
    console.log("  MOCK DATA：仅验证流程，不代表真实内容生产。");
  }

  const service = new EditorialWorkbenchService();
  const started = Date.now();

  const candidates = await service.candidates({ date });
  const selection = candidates.data;
  const trace = candidates.meta.discoveryTrace.map((entry) => `${entry.tier}:${entry.discovered}`).join(" ");
  console.log("\n[1] 候选发现");
  line("provider", candidates.meta.providerId);
  line("tier trace", trace || "-");
  for (const candidate of selection.candidateShortlist) {
    line(`#${candidate.rank}`, `${candidate.writer.name} · ${candidate.proposedWhyHerToday.tier} · ${candidate.score.weightedTotal}`);
  }

  console.log("\n[2] 资料核验");
  const research = await service.research({
    selectionId: candidates.meta.selectionId,
    candidateId: selection.selectedCandidate.id,
  });
  const pack = research.data;
  line("sources", pack.sources.length);
  line("verified", pack.verification.passedClaimIds.length);
  line("needs review", pack.verification.needsReviewClaimIds.length);
  line("rejected", pack.verification.rejectedClaimIds.length);
  line("skipped sources", pack.retrievalDiagnostics?.skippedSources.length ?? 0);
  line("readyForDraft", String(pack.readyForDraft));

  if (!pack.readyForDraft) {
    const verified = pack.claims.filter(({ verified: passed }) => passed);
    console.log("  资料不足以进入写作：");
    if (!pack.verifiedWhyHerToday) console.log("   - Why Her Today 尚未核验");
    if (!verified.some(({ category }) => category === "bio")) console.log("   - 缺少 verified bio claim");
    if (!verified.some(({ category }) => category === "work")) console.log("   - 缺少 verified work claim");
    if (verified.length < 4) console.log(`   - 仅有 ${verified.length} 条 verified claims（需要 ≥4）`);
    await mkdir(outDir, { recursive: true });
    const file = resolve(outDir, `live-smoke-${date}.json`);
    await writeFile(file, JSON.stringify({ date, diagnostics, selection, research: pack }, null, 2), "utf8");
    console.log(`\n已保存研究档案（未生成初稿）：${file}`);
    process.exitCode = 3;
    return;
  }

  console.log("\n[3] 写作与复核");
  const production = await service.produce({
    selectionId: candidates.meta.selectionId,
    researchId: research.meta.researchId,
    style: argument("style"),
  });
  const pkg = production.data;
  line("titles", pkg.draft.titles.length);
  line("blocks", pkg.draft.blocks.length);
  line("cards", pkg.draft.cards.length);
  line("review", pkg.review.recommendation);
  line("package status", pkg.status);
  console.log(`\n  标题：${pkg.draft.titles[0].text}`);
  console.log(`  Why Her Today：${pkg.verifiedContext.whyHerToday.shortReason}`);
  console.log(`  正文首段：${pkg.draft.blocks[0].text.slice(0, 80)}`);
  console.log(`  卡片 1：${pkg.draft.cards[0].title} — ${pkg.draft.cards[0].copy.slice(0, 60)}`);

  await mkdir(outDir, { recursive: true });
  const file = resolve(outDir, `live-smoke-${date}.json`);
  await writeFile(file, JSON.stringify({ date, diagnostics, package: pkg }, null, 2), "utf8");
  console.log(`\n耗时 ${((Date.now() - started) / 1000).toFixed(1)}s · 已保存审核包：${file}`);
  console.log("提醒：这只是 draft。请在工作台逐项人工审核；不自动发布到小红书。");
}

main().catch((error: unknown) => {
  console.error("\nLive smoke 失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
