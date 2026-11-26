/**
 * Deterministic HTML → text extraction for fetched research sources.
 *
 * Raw HTML would waste most of the model context on markup and navigation, so
 * sources are reduced to readable text before extraction. This is deliberately
 * dependency-free and deterministic: no readability heuristics that could
 * silently drop the sentence a claim depends on.
 */

const BLOCK_TAGS = [
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  eacute: "é",
  egrave: "è",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLocaleLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  let value = html;
  value = value.replace(/<!--[\s\S]*?-->/g, " ");
  value = value.replace(/<(script|style|noscript|template|svg|iframe|object|head)\b[\s\S]*?<\/\1>/gi, " ");
  value = value.replace(/<(script|style|noscript|template|svg|iframe|object|head)\b[^>]*\/?>/gi, " ");
  value = value.replace(new RegExp(`</?(?:${BLOCK_TAGS.join("|")})\\b[^>]*>`, "gi"), "\n");
  value = value.replace(/<[^>]+>/g, " ");
  value = decodeEntities(value);
  value = value.replace(/\r\n?/g, "\n");
  const lines = value
    .split("\n")
    .map((line) => line.replace(/[\t\f\v\u00a0 ]+/g, " ").trim())
    .filter((line) => line.length > 0);
  return lines.join("\n").trim();
}

function charsetFromContentType(contentType: string): string | undefined {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType);
  return match?.[1]?.toLocaleLowerCase();
}

function charsetFromMeta(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2_048));
  const match = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return match?.[1]?.toLocaleLowerCase();
}

/** Decode a response body, honouring declared or meta-declared charset. */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const label = charsetFromContentType(contentType) ??
    (contentType.includes("html") ? charsetFromMeta(bytes) : undefined);
  const candidates = label ? [label, "utf-8"] : ["utf-8"];
  for (const candidate of candidates) {
    try {
      return new TextDecoder(candidate, { fatal: false }).decode(bytes);
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}
