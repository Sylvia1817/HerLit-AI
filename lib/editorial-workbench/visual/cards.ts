/**
 * Card rendering templates.
 *
 * Visual language follows the 她文日历 HerLit account: warm paper, deep
 * green serif type, brick-red accents, optional photographic background for
 * the cover. The editorial pipeline only ever produces *copy plans*; nothing
 * here invents editorial content — this module is a pure presentation layer.
 *
 * Rendering is deliberately dependency-free HTML + CSS so the same markup can
 * be screenshotted by Playwright, previewed in a browser, or diffed in tests.
 */

import type { CardPlan } from "../../../types/editorial.ts";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1440;

/** The account palette: warm paper, deep green ink, brick-red accents. */
export const THEME = {
  paper: "#F8F3E7",
  ink: "#1F4A38",
  brick: "#B4502E",
  muted: "#77705F",
  darkSurface: "#1E4B39",
  darkInk: "#F4EDDD",
  darkMuted: "rgba(244,237,221,0.66)",
} as const;

export type RenderRole = CardPlan["role"] | "quote";

/** Chinese display labels for each card role. */
export const ROLE_LABELS: Record<RenderRole, string> = {
  cover: "今日封面",
  why_her_today: "为什么是今天",
  story: "她的故事",
  work: "她的作品",
  saveable_knowledge: "可以带走的",
  reading_path: "从哪里读起",
  interaction: "想听你说",
  quote: "她的金句",
};

/** Roles rendered on the deep-green surface, to give a swipe sequence rhythm. */
const DARK_ROLES: ReadonlyArray<RenderRole> = ["saveable_knowledge", "interaction"];

export type CardRenderMeta = {
  index: number;
  total: number;
  date: string;
  writerName: string;
  writerOriginalName?: string;
  writerDates?: string;
  /** Optional local image path used as the cover (or per-card) backdrop. */
  backgroundUrl?: string;
};

/** Extra, presentation-only fields accepted by the `--from` copy payload. */
export type LooseCard = {
  order: number;
  role: RenderRole;
  title: string;
  copy: string;
  /** Quote cards: short source note shown under the attribution. */
  source?: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Long copy needs a smaller type size, but the ramp is intentionally shallow:
 * shrinking too far makes cards look unset rather than composed.
 */
function copyFontSize(text: string): number {
  const length = [...text].length;
  if (length <= 56) return 40;
  if (length <= 96) return 36;
  if (length <= 150) return 32;
  if (length <= 220) return 28;
  return 25;
}

function titleFontSize(text: string, isCover: boolean): number {
  const length = [...text].length;
  if (isCover) {
    if (length <= 8) return 108;
    if (length <= 14) return 96;
    if (length <= 20) return 82;
    return 68;
  }
  if (length <= 10) return 60;
  if (length <= 18) return 52;
  if (length <= 28) return 44;
  return 38;
}

function paragraphize(text: string): string {
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br />")}</p>`).join("");
}

/** Escape a headline and honor explicit line breaks. */
function headline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br />");
}

function writerLine(meta: CardRenderMeta): string {
  const parts = [meta.writerName];
  if (meta.writerOriginalName) parts.push(meta.writerOriginalName);
  if (meta.writerDates) parts.push(meta.writerDates);
  return escapeHtml(parts.join(" · "));
}

/** Shared <style> for every layout. */
function baseCss(hasBackground: boolean): string {
  return `@page { size: ${CARD_WIDTH}px ${CARD_HEIGHT}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; background: ${THEME.paper}; }
  body {
    font-family: "Songti SC", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", "Georgia", serif;
    color: ${THEME.ink};
    ${hasBackground ? `background: url("${"__BG__"}") center / cover no-repeat;` : ""}
  }
  .veil {
    width: 100%; height: 100%;
    background: ${hasBackground
      ? "linear-gradient(175deg, rgba(248,243,231,0.94) 0%, rgba(248,243,231,0.86) 46%, rgba(248,243,231,0.42) 100%)"
      : "radial-gradient(130% 90% at 10% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 60%)"};
    display: flex; align-items: stretch; justify-content: stretch;
  }`;
}

/** Cover: poetic headline, brick-red writer name, optional photo backdrop. */
function coverCss(): string {
  return `
  .frame { position: relative; flex: 1; padding: 120px 96px 88px; display: flex; flex-direction: column; }
  header { display: flex; align-items: baseline; justify-content: space-between;
    font-size: 22px; letter-spacing: 0.3em; color: ${THEME.muted}; text-transform: uppercase; }
  header .brand { color: ${THEME.ink}; font-weight: 600; }
  main { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 44px; }
  .kicker { font-size: 26px; letter-spacing: 0.4em; color: ${THEME.brick}; }
  h1 { font-size: 96px; line-height: 1.34; font-weight: 500; letter-spacing: 0.02em; }
  .ornament { display: flex; align-items: center; gap: 18px; color: ${THEME.brick}; }
  .ornament::before, .ornament::after { content: ""; width: 96px; height: 1px; background: ${THEME.brick}; opacity: .65; }
  .ornament span { font-size: 30px; }
  .writer { font-size: 40px; letter-spacing: 0.14em; color: ${THEME.brick}; }
  footer { display: flex; justify-content: space-between; font-size: 22px;
    letter-spacing: 0.22em; color: ${THEME.muted}; }`;
}

/** Content cards: cream sheet, hairline frame, kicker + title + copy. */
function contentCss(titleSize: number, copySize: number, isDark: boolean, hasBackground: boolean): string {
  const ink = isDark ? THEME.darkInk : THEME.ink;
  const muted = isDark ? THEME.darkMuted : THEME.muted;
  const line = isDark ? "rgba(244,237,221,0.22)" : "rgba(31,74,56,0.2)";
  return `
  body { color: ${ink}; }
  .frame {
    position: relative; flex: 1; margin: 52px;
    padding: 84px 88px 72px;
    ${hasBackground ? "" : `background: ${isDark ? THEME.darkSurface : THEME.paper};`}
    border: 1px solid ${line};
    box-shadow: 0 0 0 14px ${isDark ? "rgba(30,75,57,0.35)" : "rgba(31,74,56,0.08)"};
    display: flex; flex-direction: column;
  }
  .frame::after { content: ""; position: absolute; left: 88px; right: 88px; top: 148px; height: 1px; background: ${line}; }
  header { display: flex; align-items: baseline; justify-content: space-between;
    font-size: 22px; letter-spacing: 0.3em; color: ${muted}; text-transform: uppercase; }
  header .brand { color: ${isDark ? THEME.darkInk : THEME.ink}; font-weight: 600; }
  main { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 40px; padding-top: 72px; }
  .kicker { font-size: 25px; letter-spacing: 0.36em; color: ${THEME.brick}; }
  h1 { font-size: ${titleSize}px; line-height: 1.36; font-weight: 500; }
  .copy { font-size: ${copySize}px; line-height: 1.92; display: flex; flex-direction: column; gap: 0.72em; color: ${ink}; opacity: .92; }
  footer { display: flex; align-items: baseline; justify-content: space-between; gap: 24px;
    padding-top: 26px; border-top: 1px solid ${line}; font-size: 23px; color: ${muted}; letter-spacing: 0.05em; }
  footer .date { letter-spacing: 0.18em; white-space: nowrap; }`;
}

/** Quote card: thick green border, oversized quote marks, centered text. */
function quoteCss(): string {
  return `
  body { padding: 56px; }
  .card {
    position: relative; flex: 1; background: ${THEME.paper};
    border: 3px solid ${THEME.ink}; padding: 120px 110px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  }
  .card::before { content: ""; position: absolute; inset: 12px; border: 1px solid rgba(31,74,56,0.35); pointer-events: none; }
  .qmark { font-size: 150px; line-height: 1; color: ${THEME.brick}; font-family: Georgia, serif; }
  .qmark.close { align-self: flex-end; margin-top: 56px; }
  .quote { font-size: 52px; line-height: 1.7; margin: 56px 0 40px; }
  .attribution { font-size: 34px; letter-spacing: 0.08em; font-style: italic; color: ${THEME.ink}; }
  .divider { display: flex; align-items: center; gap: 16px; margin: 48px 0; color: ${THEME.brick}; }
  .divider::before, .divider::after { content: ""; width: 88px; height: 1px; background: ${THEME.brick}; opacity: .6; }
  .divider span { font-size: 26px; }
  .source { font-size: 26px; letter-spacing: 0.12em; color: ${THEME.muted}; }`;
}

/**
 * Build the standalone HTML document for one card. Kept as a full document
 * (not a fragment) so it can be loaded with `page.setContent` verbatim.
 */
export function buildCardHtml(card: LooseCard, meta: CardRenderMeta): string {
  const isCover = card.role === "cover";
  const isQuote = card.role === "quote";
  const isDark = !isCover && !isQuote && DARK_ROLES.includes(card.role);
  const counter = `${String(meta.index).padStart(2, "0")} / ${String(meta.total).padStart(2, "0")}`;

  const bg = meta.backgroundUrl && (isCover || card.role === "why_her_today") ? meta.backgroundUrl : undefined;
  let css: string;
  let body: string;

  if (isQuote) {
    css = baseCss(false) + quoteCss();
    body = `<div class="card">
      <div class="qmark">&ldquo;</div>
      <p class="quote">${escapeHtml(card.copy)}</p>
      <p class="attribution">${headline(card.title)}</p>
      <div class="divider"><span>❖</span></div>
      <p class="source">${escapeHtml(card.source ?? `${writerLine(meta)} · ${meta.date}`)}</p>
      <div class="qmark close">&rdquo;</div>
    </div>`;
  } else if (isCover) {
    css = baseCss(Boolean(bg)) + coverCss();
    body = `<div class="veil"><div class="frame">
      <header><span class="brand">HerLit</span><span>${counter}</span></header>
      <main>
        <p class="kicker">每 日 一 位 女 作 家</p>
        <h1>${headline(card.title)}</h1>
        <div class="ornament"><span>❖</span></div>
        <p class="writer">${writerLine(meta)}</p>
      </main>
      <footer><span>${escapeHtml(meta.date)}</span><span>她文日历</span></footer>
    </div></div>`;
  } else {
    css = baseCss(Boolean(bg)) + contentCss(titleFontSize(card.title, false), copyFontSize(card.copy), isDark, Boolean(bg));
    body = `<div class="veil"><div class="frame">
      <header><span class="brand">HerLit</span><span>${counter}</span></header>
      <main>
        <p class="kicker">${escapeHtml(ROLE_LABELS[card.role] ?? "HerLit")}</p>
        <h1>${headline(card.title)}</h1>
        <div class="copy">${paragraphize(card.copy)}</div>
      </main>
      <footer><span class="writer">${writerLine(meta)}</span><span class="date">${escapeHtml(meta.date)}</span></footer>
    </div></div>`;
  }

  css = css.replace("__BG__", bg ?? "");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(card.title)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export type CardFile = {
  index: number;
  role: RenderRole;
  file: string;
  title: string;
};

export function cardFileName(card: LooseCard, index: number): string {
  return `${String(index).padStart(2, "0")}-${card.role}.png`;
}

export type CopyPayload = {
  date: string;
  writer: { name: string; originalName?: string; birthDate?: string; deathDate?: string };
  titles: { text: string; style?: string }[];
  body: string;
  hashtags: string[];
  readerHook: string;
  cards: LooseCard[];
};

/** Payloads accepted by `render:cards --from`; shape errors must be actionable. */
export function validateCopyPayload(payload: unknown): CopyPayload {
  const fail = (message: string): never => {
    throw new Error(`content.json 无效：${message}`);
  };
  if (typeof payload !== "object" || payload === null) fail("顶层必须是 JSON 对象");
  const root = payload as Record<string, unknown>;
  if (typeof root.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(root.date)) fail("date 必须是 YYYY-MM-DD 字符串");
  const date = root.date as string;

  const writer = root.writer as Record<string, unknown> | undefined;
  if (typeof writer !== "object" || writer === null || typeof writer.name !== "string" || !writer.name.trim()) {
    fail("writer.name 必须是非空字符串");
  }

  if (!Array.isArray(root.cards) || root.cards.length < 3 || root.cards.length > 6) {
    fail("cards 必须是 3–6 张的数组");
  }
  const cards: LooseCard[] = (root.cards as unknown[]).map((entry, index) => {
    if (typeof entry !== "object" || entry === null) fail(`cards[${index}] 必须是对象`);
    const card = entry as Record<string, unknown>;
    const role = card.role;
    if (typeof role !== "string" || !(role in ROLE_LABELS)) {
      fail(`cards[${index}].role 必须是 ${Object.keys(ROLE_LABELS).join(" / ")} 之一`);
    }
    if (typeof card.title !== "string" || !card.title.trim()) fail(`cards[${index}].title 必须是非空字符串`);
    if (typeof card.copy !== "string" || !card.copy.trim()) fail(`cards[${index}].copy 必须是非空字符串`);
    const title = card.title as string;
    const copy = card.copy as string;
    return {
      order: index + 1,
      role: role as RenderRole,
      title,
      copy,
      source: typeof card.source === "string" ? card.source : undefined,
    };
  });
  if (cards[0].role !== "cover") fail("cards[0] 的 role 必须是 cover（封面在第一位）");

  if (!Array.isArray(root.titles) || (root.titles as unknown[]).length === 0) fail("titles 不能为空");

  return {
    date,
    writer: writer as CopyPayload["writer"],
    titles: root.titles as CopyPayload["titles"],
    body: typeof root.body === "string" ? root.body : "",
    hashtags: Array.isArray(root.hashtags) ? (root.hashtags as string[]).filter((tag) => typeof tag === "string") : [],
    readerHook: typeof root.readerHook === "string" ? root.readerHook : "",
    cards,
  };
}
