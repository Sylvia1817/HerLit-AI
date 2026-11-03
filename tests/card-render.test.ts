import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  ROLE_LABELS,
  buildCardHtml,
  cardFileName,
  escapeHtml,
  validateCopyPayload,
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

test("cover card uses the standalone kicker and brick-red writer name", () => {
  const html = buildCardHtml(card({ role: "cover", order: 1 }), { index: 1, total: 3, date: "2026-11-03", writerName: "测试" });
  assert.match(html, /每 日 一 位 女 作 家/);
  assert.doesNotMatch(html, /今日封面/);
  assert.match(html, /color: #B4502E/);
});

test("dark roles get the deep-green surface, light roles never do", () => {
  const dark = buildCardHtml(card({ role: "saveable_knowledge" }), { index: 2, total: 3, date: "2026-11-03", writerName: "测试" });
  assert.match(dark, /#1E4B39/);
  const light = buildCardHtml(card({ role: "story" }), { index: 2, total: 3, date: "2026-11-03", writerName: "测试" });
  assert.doesNotMatch(light, /background: #1E4B39/);
});

test("quote card centers the quote, attribution and source", () => {
  const html = buildCardHtml(
    { order: 5, role: "quote", title: "— Isabel Allende", copy: "My most significant achievements are not my books.", source: "作者官网 Biography" },
    { index: 5, total: 6, date: "2026-11-03", writerName: "伊莎贝尔·阿连德" },
  );
  assert.match(html, /&ldquo;/);
  assert.match(html, /My most significant achievements are not my books\./);
  assert.match(html, /— Isabel Allende/);
  assert.match(html, /作者官网 Biography/);
  // quote cards never leak the writer+date footer into the attribution
  assert.doesNotMatch(html, /伊莎贝尔·阿连德 · 2026-11-03/);
});

test("copy font size ramps down as copy grows", () => {
  const sizes = [40, 80, 130, 190, 260].map((length) => {
    const html = buildCardHtml(card({ copy: "字".repeat(length) }), { index: 1, total: 1, date: "2026-11-03", writerName: "测试" });
    return Number(html.match(/\.copy \{ font-size: (\d+)px/)?.[1]);
  });
  assert.deepEqual(sizes, [40, 36, 32, 28, 25]);
  for (const [left, right] of sizes.slice(0, -1).map((value, index) => [value, sizes[index + 1]])) {
    assert.ok(left > right, `expected monotonic ramp, got ${left} -> ${right}`);
  }
});

test("every card role has a display label and a deterministic file name", () => {
  const roles = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];
  assert.ok(roles.length >= 8, "quote role must be present for copy mode");
  for (const role of roles) assert.ok(ROLE_LABELS[role].length > 0, `missing label for ${role}`);
  assert.equal(cardFileName(card({ role: "cover", order: 1 }), 1), "01-cover.png");
  assert.equal(cardFileName({ order: 5, role: "quote", title: "t", copy: "c" }, 5), "05-quote.png");
});

test("paragraphize keeps double newlines as paragraphs and escapes single ones", () => {
  const html = buildCardHtml(card({ copy: "第一段\n第二行\n\n第二段" }), { index: 1, total: 1, date: "2026-11-03", writerName: "测试" });
  assert.match(html, /第一段<br \/>第二行/);
  assert.match(html, /<p>第二段<\/p>/);
});

test("validateCopyPayload accepts a minimal valid payload and normalizes order", () => {
  const payload = validateCopyPayload({
    date: "2026-11-03",
    writer: { name: "测试作家" },
    titles: [{ text: "标题" }],
    cards: [
      { role: "cover", title: "封面", copy: "c" },
      { role: "story", title: "故事", copy: "c" },
      { role: "quote", title: "— Writer", copy: "A quote.", source: "Source" },
    ],
  });
  assert.equal(payload.cards.map((entry) => entry.order).join(","), "1,2,3");
  assert.equal(payload.cards[2].source, "Source");
});

test("validateCopyPayload rejects bad shapes with actionable messages", () => {
  const base = {
    date: "2026-11-03",
    writer: { name: "测试" },
    titles: [{ text: "标题" }],
    cards: [
      { role: "cover", title: "封面", copy: "c" },
      { role: "story", title: "故事", copy: "c" },
      { role: "story", title: "结尾", copy: "c" },
    ],
  };
  assert.throws(() => validateCopyPayload({ ...base, date: "2026/11/03" }), /date 必须是 YYYY-MM-DD/);
  assert.throws(() => validateCopyPayload({ ...base, cards: base.cards.slice(0, 2) }), /cards 必须是 3–6 张/);
  assert.throws(() => validateCopyPayload({ ...base, writer: { name: " " } }), /writer\.name/);
  assert.throws(
    () => validateCopyPayload({ ...base, cards: [{ role: "story", title: "a", copy: "b" }, ...base.cards.slice(1)] }),
    /cards\[0\] 的 role 必须是 cover/,
  );
});

test("buildCardHtml escapes hostile copy payloads end to end", () => {
  const payload = validateCopyPayload({
    date: "2026-11-03",
    writer: { name: "测试<script>alert(9)</script>" },
    titles: [{ text: "标题" }],
    cards: [
      { role: "cover", title: "<img src=x onerror=alert(1)>", copy: "c" },
      { role: "quote", title: "— <b>x</b>", copy: "<script>alert(2)</script>" },
      { role: "story", title: "故事", copy: "<iframe src=//evil.example></iframe>" },
    ],
  });
  for (const entry of payload.cards) {
    const html = buildCardHtml(entry, { index: 1, total: 3, date: payload.date, writerName: payload.writer.name });
    assert.doesNotMatch(html, /<script>alert|<img src=x|<iframe src=/);
    assert.match(html, /&lt;(script|img|iframe)/);
  }
});
