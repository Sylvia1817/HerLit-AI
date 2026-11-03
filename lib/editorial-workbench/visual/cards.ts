/**
 * Card rendering templates.
 *
 * The editorial pipeline only ever produces *copy plans* (`CardPlan`): order,
 * role, title, copy and an internal visual direction. Nothing here invents
 * editorial content — this module is a pure presentation layer that turns an
 * already-reviewed plan into a 1080x1440 (3:4) Xiaohongshu-ready image.
 *
 * Rendering is deliberately dependency-free HTML + CSS so the same markup can
 * be screenshotted by Playwright, previewed in a browser, or diffed in tests.
 */

import type { CardPlan } from "../../../types/editorial.ts";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1440;

/** Chinese display labels for each card role. */
export const ROLE_LABELS: Record<CardPlan["role"], string> = {
  cover: "今日封面",
  why_her_today: "为什么是今天",
  story: "她的故事",
  work: "她的作品",
  saveable_knowledge: "可以带走的",
  reading_path: "从哪里读起",
  interaction: "想听你说",
};

/** Roles rendered on the dark surface, to give a swipe sequence a rhythm. */
const DARK_ROLES: ReadonlyArray<CardPlan["role"]> = ["saveable_knowledge", "interaction"];

export type CardRenderMeta = {
  index: number;
  total: number;
  date: string;
  writerName: string;
  writerOriginalName?: string;
  writerDates?: string;
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
  if (length <= 56) return 42;
  if (length <= 96) return 38;
  if (length <= 150) return 33;
  if (length <= 220) return 29;
  return 26;
}

function titleFontSize(text: string, isCover: boolean): number {
  const length = [...text].length;
  if (isCover) {
    if (length <= 12) return 96;
    if (length <= 20) return 82;
    if (length <= 28) return 70;
    return 60;
  }
  if (length <= 10) return 62;
  if (length <= 18) return 54;
  if (length <= 28) return 46;
  return 40;
}

function paragraphize(text: string): string {
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br />")}</p>`).join("");
}

function writerLine(meta: CardRenderMeta): string {
  const parts = [meta.writerName];
  if (meta.writerOriginalName) parts.push(meta.writerOriginalName);
  if (meta.writerDates) parts.push(meta.writerDates);
  return escapeHtml(parts.join(" · "));
}

/**
 * Build the standalone HTML document for one card. Kept as a full document
 * (not a fragment) so it can be loaded with `page.setContent` verbatim.
 */
export function buildCardHtml(card: CardPlan, meta: CardRenderMeta): string {
  const isCover = card.role === "cover";
  const isDark = DARK_ROLES.includes(card.role);
  const label = ROLE_LABELS[card.role] ?? "HerLit";
  const counter = `${String(meta.index).padStart(2, "0")} / ${String(meta.total).padStart(2, "0")}`;
  const titleSize = titleFontSize(card.title, isCover);
  const copySize = copyFontSize(card.copy);
  const kicker = isCover ? "每日一位女作家" : label;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(card.title)}</title>
<style>
  @page { size: ${CARD_WIDTH}px ${CARD_HEIGHT}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${CARD_WIDTH}px;
    height: ${CARD_HEIGHT}px;
    background: ${isDark ? "#241F1B" : "#F8F4EC"};
  }
  body {
    font-family: "Songti SC", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", "Georgia", serif;
    color: ${isDark ? "#F6EFE3" : "#221E1A"};
    display: flex;
    align-items: stretch;
    justify-content: stretch;
  }
  .frame {
    position: relative;
    flex: 1;
    margin: 44px;
    padding: 68px 76px 64px;
    border: ${isDark ? "1px solid rgba(246,239,227,0.22)" : "1px solid rgba(34,30,26,0.16)"};
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(120% 80% at 8% 0%, ${isDark ? "rgba(217,168,142,0.10)" : "rgba(255,255,255,0.55)"} 0%, rgba(255,255,255,0) 62%),
      ${isDark ? "linear-gradient(165deg, #2A241F 0%, #201B17 100%)" : "linear-gradient(165deg, #FBF8F1 0%, #F2EADC 100%)"};
  }
  .frame::after {
    content: "";
    position: absolute;
    left: 76px;
    right: 76px;
    top: 132px;
    height: 1px;
    background: ${isDark ? "rgba(246,239,227,0.18)" : "rgba(34,30,26,0.12)"};
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 22px;
    letter-spacing: 0.28em;
    color: ${isDark ? "rgba(246,239,227,0.72)" : "rgba(34,30,26,0.56)"};
    text-transform: uppercase;
  }
  header .brand { font-weight: 600; }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: ${isCover ? "48px" : "40px"};
    padding-top: 96px;
  }
  .kicker {
    font-size: 26px;
    letter-spacing: 0.34em;
    color: ${isDark ? "#D9A88E" : "#8A4F3D"};
  }
  h1 {
    font-size: ${titleSize}px;
    line-height: 1.3;
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .copy {
    font-size: ${copySize}px;
    line-height: 1.92;
    color: ${isDark ? "rgba(246,239,227,0.86)" : "rgba(34,30,26,0.80)"};
    display: flex;
    flex-direction: column;
    gap: 0.72em;
  }
  .copy p { text-indent: 0; }
  footer {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
    padding-top: 28px;
    border-top: 1px solid ${isDark ? "rgba(246,239,227,0.18)" : "rgba(34,30,26,0.12)"};
    font-size: 24px;
    color: ${isDark ? "rgba(246,239,227,0.66)" : "rgba(34,30,26,0.52)"};
    letter-spacing: 0.04em;
  }
  footer .date { letter-spacing: 0.18em; white-space: nowrap; }
</style>
</head>
<body>
  <div class="frame">
    <header>
      <span class="brand">HerLit</span>
      <span class="counter">${counter}</span>
    </header>
    <main>
      <p class="kicker">${escapeHtml(kicker)}</p>
      <h1>${escapeHtml(card.title)}</h1>
      <div class="copy">${paragraphize(card.copy)}</div>
    </main>
    <footer>
      <span class="writer">${writerLine(meta)}</span>
      <span class="date">${escapeHtml(meta.date)}</span>
    </footer>
  </div>
</body>
</html>`;
}

export type CardFile = {
  index: number;
  role: CardPlan["role"];
  file: string;
  title: string;
};

export function cardFileName(card: CardPlan, index: number): string {
  return `${String(index).padStart(2, "0")}-${card.role}.png`;
}
