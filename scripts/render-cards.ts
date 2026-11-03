/**
 * Daily content workflow: date → candidates → research → draft/cards → images.
 *
 * Produces everything a human needs in order to review and post by hand:
 *
 *   runtime/publish/<date>/01-cover.png …    3:4 cards, 1080x1440
 *   runtime/publish/<date>/copy.txt          titles, body, hashtags
 *   runtime/publish/<date>/package.json      full review package (status: draft)
 *   runtime/publish/<date>/preview.html      all cards on one page
 *
 * It never approves a package and never publishes anywhere. Approval still
 * happens in the workbench (or `npm run smoke:live` for inspection), which is
 * what keeps the human gate intact.
 *
 *   npm run render:cards -- --date 2026-11-03
 *   npm run render:cards -- --date 2026-11-03 --style "温柔克制"
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getEditorialDate } from "../lib/editorial-workbench/date.ts";
import { describeEditorialRuntime } from "../lib/editorial-workbench/diagnostics.ts";
import { EditorialWorkbenchService } from "../lib/editorial-workbench/service.ts";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  buildCardHtml,
  cardFileName,
  type CardFile,
} from "../lib/editorial-workbench/visual/cards.ts";
import type { CardPlan } from "../types/editorial.ts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function line(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(16, " ")} ${value}`);
}

function writerDates(birthDate?: string, deathDate?: string): string | undefined {
  const birth = birthDate?.slice(0, 4);
  const death = deathDate?.slice(0, 4);
  if (birth && death) return `${birth}—${death}`;
  if (birth) return `${birth}—`;
  return undefined;
}

function copySheet(input: {
  date: string;
  titles: readonly { text: string; style?: string }[];
  body: string;
  hashtags: readonly string[];
  cards: readonly CardPlan[];
  readerHook: string;
  verification: { readyForDraft: boolean; verified: number; needsReview: number };
}): string {
  const titleLines = input.titles.map((title, index) => `${index + 1}. ${title.text}`).join("\n");
  const cardLines = input.cards
    .map((card, index) => `\n[${String(index + 1).padStart(2, "0")}] ${card.role}\n${card.title}\n${card.copy}`)
    .join("\n");
  return `HerLit 每日图文 · ${input.date}
状态：DRAFT（未审核，未发布）

—— 标题候选 ——
${titleLines}

—— 正文 ——
${input.body}

—— 话题标签 ——
${input.hashtags.join(" ")}

—— 评论区引导 ——
${input.readerHook}

—— 卡片文案（供核对图片）——
${cardLines}

—— 核验摘要 ——
readyForDraft: ${input.verification.readyForDraft ? "是" : "否"} · verified claims: ${input.verification.verified} · needs review: ${input.verification.needsReview}
提示：图片不含水印，可直接上传；发布前请在作品台确认「人工审核通过」。
`;
}

function previewHtml(input: { date: string; files: CardFile[]; title: string }): string {
  const figures = input.files
    .map(
      (file) => `    <figure>
      <img src="${file.file}" alt="${file.role}" />
      <figcaption>${String(file.index).padStart(2, "0")} · ${file.role}</figcaption>
    </figure>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>HerLit ${input.date} 审核预览</title>
<style>
  body { margin: 0; padding: 48px; background: #EDE7DC; color: #221E1A;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: .04em; }
  p { color: #6B6258; font-size: 14px; margin-top: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 28px; margin-top: 32px; }
  figure { margin: 0; }
  img { width: 100%; display: block; border-radius: 6px; box-shadow: 0 8px 24px rgba(34,30,26,.14); }
  figcaption { font-size: 12px; color: #6B6258; letter-spacing: .1em; margin-top: 10px; }
</style>
</head>
<body>
  <h1>${input.title}</h1>
  <p>${input.date} · ${input.files.length} 张卡片 · 1080×1440 · 待人工审核</p>
  <div class="grid">
${figures}
  </div>
</body>
</html>`;
}

async function main(): Promise<void> {
  const date = argument("date") ?? getEditorialDate();
  const outDir = resolve(argument("out") ?? `runtime/publish/${date}`);
  const diagnostics = describeEditorialRuntime();

  console.log(`\nHerLit 每日图文 · ${date}`);
  line("provider mode", diagnostics.mode);
  if (diagnostics.mode === "live") {
    if (!diagnostics.ready) {
      line("配置缺失", diagnostics.missing.join(", ") || "-");
      for (const issue of diagnostics.issues) console.log(`  ${issue.code}: ${issue.message}`);
      console.error("\n未产出图片：live 配置不完整。修复后重试，或未设置 EDITORIAL_PROVIDER_MODE 时使用 mock。");
      process.exitCode = 2;
      return;
    }
    line("model", `${diagnostics.model?.protocol} · ${diagnostics.model?.model}`);
    line("search", `${diagnostics.search?.protocol} @ ${diagnostics.search?.host}`);
  } else {
    console.log("  MOCK DATA：图片版式与流程可用，但内容不是真实生产结果。");
  }

  const service = new EditorialWorkbenchService();
  const started = Date.now();

  const candidates = await service.candidates({ date });
  const selection = candidates.data;
  const writer = selection.selectedCandidate.writer;
  console.log("\n[1] 候选");
  for (const candidate of selection.candidateShortlist) {
    line(`#${candidate.rank}`, `${candidate.writer.name} · ${candidate.proposedWhyHerToday.tier} · ${candidate.score.weightedTotal}`);
  }

  console.log("\n[2] 核验");
  const research = await service.research({
    selectionId: candidates.meta.selectionId,
    candidateId: selection.selectedCandidate.id,
  });
  const pack = research.data;
  const verified = pack.claims.filter(({ verified: passed }) => passed);
  line("sources", pack.sources.length);
  line("verified", verified.length);
  line("needs review", pack.verification.needsReviewClaimIds.length);
  line("readyForDraft", String(pack.readyForDraft));

  if (!pack.readyForDraft) {
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, "research.json"), JSON.stringify({ date, selection, research: pack }, null, 2), "utf8");
    console.error(`\n资料不足，未生成初稿与图片。研究档案：${resolve(outDir, "research.json")}`);
    process.exitCode = 3;
    return;
  }

  console.log("\n[3] 初稿与卡片");
  const production = await service.produce({
    selectionId: candidates.meta.selectionId,
    researchId: research.meta.researchId,
    style: argument("style"),
  });
  const pkg = production.data;
  const cards = pkg.draft.cards as readonly CardPlan[];
  line("cards", cards.length);
  line("review", pkg.review.recommendation);

  console.log("\n[4] 渲染图片");
  await mkdir(outDir, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  // deviceScaleFactor 1 keeps the output at exactly 1080x1440 (the size
  // Xiaohongshu recommends). Headless shell on Windows fails to capture
  // screenshots at dsf 2, so 1 is also the portable choice.
  const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: CARD_HEIGHT }, deviceScaleFactor: 1 });
  const files: CardFile[] = [];
  try {
    for (const [offset, card] of cards.entries()) {
      const index = offset + 1;
      const meta = {
        index,
        total: cards.length,
        date,
        writerName: writer.name,
        writerOriginalName: writer.originalName,
        writerDates: writerDates(writer.birthDate, writer.deathDate),
      };
      await page.setContent(buildCardHtml(card, meta), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const file = cardFileName(card, index);
      await page.screenshot({ path: resolve(outDir, file), type: "png" });
      files.push({ index, role: card.role, file, title: card.title });
      line(`card ${index}`, `${file} · ${card.title}`);
    }
  } finally {
    await browser.close();
  }

  const sheet = copySheet({
    date,
    titles: pkg.draft.titles,
    body: pkg.draft.body,
    hashtags: pkg.draft.hashtags,
    cards,
    readerHook: pkg.draft.readerHook,
    verification: {
      readyForDraft: pack.readyForDraft,
      verified: verified.length,
      needsReview: pack.verification.needsReviewClaimIds.length,
    },
  });
  await writeFile(resolve(outDir, "copy.txt"), sheet, "utf8");
  await writeFile(
    resolve(outDir, "package.json"),
    JSON.stringify({ date, status: "draft", review: pkg.review, draft: pkg.draft, verifiedContext: pkg.verifiedContext, sources: pack.sources }, null, 2),
    "utf8",
  );
  await writeFile(
    resolve(outDir, "preview.html"),
    previewHtml({ date, files, title: `${writer.name} · ${pkg.draft.titles[0]?.text ?? ""}` }),
    "utf8",
  );

  console.log(`\n输出目录：${outDir}`);
  console.log(`耗时 ${((Date.now() - started) / 1000).toFixed(1)}s · ${files.length} 张图片`);
  console.log("提醒：这是 draft，图片未加水印。请人工审核后再发布；本脚本不会发布到小红书。");
}

main().catch((error: unknown) => {
  console.error("\n每日图文生成失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
