import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  ROLE_LABELS,
  buildCardHtml,
  cardFileName,
  escapeHtml,
} from "../lib/editorial-workbench/visual/cards.ts";
import type { CardPlan } from "../types/editorial.ts";

function card(overrides: Partial<CardPlan> = {}): CardPlan {
  return {
    order: 2,
    role: "story",
    title: "她在时代的缝隙里写作",
    copy: "一九二三年的秋天，她把第一份手稿寄给杂志社。",
    visualDirection: "internal-only",
    evidenceClaimIds: [],
    ...overrides,
  };
}

test("escapeHtml neutralizes markup and attribute breakouts", () => {
  assert.equal(
    escapeHtml(`</div><img src=x onerror="alert('1')">&`),
    "&lt;/div&gt;&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;",
  );
});

test("buildCardHtml renders role label, counter and writer line without provider-only fields", () => {
  const html = buildCardHtml(card(), {
    index: 2,
    total: 5,
    date: "2026-11-03",
    writerName: "张爱玲",
    writerOriginalName: "Eileen Chang",
    writerDates: "1920—1995",
  });
  assert.match(html, new RegExp(`width: ${CARD_WIDTH}px`));
  assert.match(html, new RegExp(`height: ${CARD_HEIGHT}px`));
  assert.match(html, /她的故事/);
  assert.match(html, /02 \/ 05/);
  assert.match(html, /张爱玲 · Eileen Chang · 1920—1995/);
  assert.match(html, /2026-11-03/);
  // visualDirection is internal guidance and must never reach the artwork.
  assert.doesNotMatch(html, /internal-only/);
});

test("buildCardHtml escapes hostile card copy", () => {
  const hostile = card({ title: "<script>alert(1)</script>", copy: "<img src=x onerror=alert(2)>" });
  const html = buildCardHtml(hostile, { index: 1, total: 3, date: "2026-11-03", writerName: "测试" });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test("cover card uses the standalone kicker instead of a role label", () => {
  const html = buildCardHtml(card({ role: "cover", order: 1 }), { index: 1, total: 3, date: "2026-11-03", writerName: "测试" });
  assert.match(html, /每日一位女作家/);
  assert.doesNotMatch(html, /今日封面/);
});

test("dark roles get the dark surface class palette", () => {
  const dark = buildCardHtml(card({ role: "saveable_knowledge" }), { index: 2, total: 3, date: "2026-11-03", writerName: "测试" });
  assert.match(dark, /#241F1B/);
  const light = buildCardHtml(card({ role: "story" }), { index: 2, total: 3, date: "2026-11-03", writerName: "测试" });
  assert.doesNotMatch(light, /#241F1B/);
});

test("copy font size ramps down as copy grows", () => {
  const sizes = [40, 80, 130, 190, 260].map((length) => {
    const html = buildCardHtml(card({ copy: "字".repeat(length) }), { index: 1, total: 1, date: "2026-11-03", writerName: "测试" });
    return Number(html.match(/\.copy \{\n    font-size: (\d+)px/)?.[1]);
  });
  assert.deepEqual(sizes, [42, 38, 33, 29, 26]);
  for (const [left, right] of sizes.slice(0, -1).map((value, index) => [value, sizes[index + 1]])) {
    assert.ok(left > right, `expected monotonic ramp, got ${left} -> ${right}`);
  }
});

test("every card role has a display label and a deterministic file name", () => {
  const roles = Object.keys(ROLE_LABELS) as CardPlan["role"][];
  assert.ok(roles.length >= 7);
  for (const role of roles) assert.ok(ROLE_LABELS[role].length > 0, `missing label for ${role}`);
  assert.equal(cardFileName(card({ role: "cover", order: 1 }), 1), "01-cover.png");
  assert.equal(cardFileName(card({ role: "interaction", order: 6 }), 6), "06-interaction.png");
});

test("paragraphize keeps double newlines as paragraphs and escapes single ones", () => {
  const html = buildCardHtml(card({ copy: "第一段\n第二行\n\n第二段" }), { index: 1, total: 1, date: "2026-11-03", writerName: "测试" });
  assert.match(html, /第一段<br \/>第二行/);
  assert.match(html, /<p>第二段<\/p>/);
});
