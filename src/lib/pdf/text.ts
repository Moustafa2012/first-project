import "server-only";
import type PDFDocument from "pdfkit";
import bidiFactory from "bidi-js";

/**
 * Bidirectional text for PDFKit. PDFKit shapes Arabic (via fontkit) but does not reorder mixed Arabic / Latin / digit
 * text, so we run the Unicode bidi algorithm ourselves, split the visual runs by script (the bundled Alyamama font ships
 * as separate Arabic and Latin subsets) and draw the runs left to right in visual order.
 */
const bidi = bidiFactory();

export type FontKey = "ar" | "arb" | "la" | "lab";
export const FONT_FILES: Record<FontKey, string> = {
  ar: "Alyamama-arabic-regular.ttf", arb: "Alyamama-arabic-bold.ttf", la: "Alyamama-latin-regular.ttf", lab: "Alyamama-latin-bold.ttf",
};

const isArabicScript = (cp: number) =>
  (cp >= 0x0600 && cp <= 0x06ff) ||
  (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff) || cp === 0x200c || cp === 0x200d;

export interface Piece { text: string; arabic: boolean }

/** Visual-order pieces of one line. `rtl` = paragraph direction. */
export function visualPieces(raw: string, rtl: boolean): Piece[] {
  // fancy spaces and invisible direction marks (Intl output) have no glyph in the subset fonts
  const text = raw.replace(/[\u00a0\u2007\u2009\u202f]/g, " ").replace(/[\u200e\u200f\u061c\u2066-\u2069\u202a-\u202e]/g, "");
  if (!text) return [];
  const levels = bidi.getEmbeddingLevels(text, rtl ? "rtl" : "ltr");
  const chars = Array.from(text);
  // map code point index -> UTF-16 index for the per-code-unit levels array
  const runs: { text: string; level: number }[] = [];
  let unit = 0;
  for (const ch of chars) {
    const lvl = levels.levels[unit] as number;
    const last = runs[runs.length - 1];
    if (last && last.level === lvl) last.text += ch; else runs.push({ text: ch, level: lvl });
    unit += ch.length;
  }
  // UAX #9 rule L2: reverse runs from the highest level down to the lowest odd level
  const max = Math.max(...runs.map((r) => r.level));
  const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), max + 1);
  const order = runs.map((_, i) => i);
  for (let lvl = max; lvl >= minOdd; lvl--) {
    for (let i = 0; i < order.length; i++) {
      if (runs[order[i]].level < lvl) continue;
      let j = i;
      while (j + 1 < order.length && runs[order[j + 1]].level >= lvl) j++;
      const seg = order.slice(i, j + 1).reverse();
      order.splice(i, seg.length, ...seg);
      i = j;
    }
  }
  const out: Piece[] = [];
  for (const idx of order) {
    const r = runs[idx];
    const odd = r.level % 2 === 1;
    // split by font coverage in logical order, then flip the pieces of right-to-left runs
    const parts: Piece[] = [];
    for (const ch of Array.from(r.text)) {
      const arabic = isArabicScript(ch.codePointAt(0) ?? 0);
      const last = parts[parts.length - 1];
      if (last && last.arabic === arabic) last.text += ch; else parts.push({ text: ch, arabic });
    }
    out.push(...(odd ? parts.reverse() : parts));
  }
  // mirrored glyphs inside right-to-left runs
  return out;
}

const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<", "«": "»", "»": "«" };

export function setFont(doc: InstanceType<typeof PDFDocument>, arabic: boolean, bold: boolean) {
  doc.font(arabic ? (bold ? "arb" : "ar") : bold ? "lab" : "la");
}

export function widthOf(doc: InstanceType<typeof PDFDocument>, text: string, size: number, bold: boolean, rtl: boolean): number {
  let w = 0;
  for (const p of visualPieces(text, rtl)) { setFont(doc, p.arabic, bold); w += doc.fontSize(size).widthOfString(p.text); }
  return w;
}

/** Draws one line. `x` is the left edge of the box of width `width`; align start/end follow the paragraph direction. */
export function drawLine(doc: InstanceType<typeof PDFDocument>, text: string, x: number, y: number, o: { size: number; bold?: boolean; rtl: boolean; width: number; align?: "start" | "end" | "center"; color?: string }) {
  const bold = Boolean(o.bold);
  const pieces = visualPieces(text, o.rtl);
  const total = pieces.reduce((n, p) => { setFont(doc, p.arabic, bold); return n + doc.fontSize(o.size).widthOfString(p.text); }, 0);
  const align = o.align ?? "start";
  const physical = align === "center" ? "center" : (align === "start") === !o.rtl ? "left" : "right";
  let cx = physical === "left" ? x : physical === "right" ? x + o.width - total : x + (o.width - total) / 2;
  doc.fillColor(o.color ?? "#0f2229");
  for (const p of pieces) {
    setFont(doc, p.arabic, bold);
    doc.fontSize(o.size);
    const shown = o.rtl && !p.arabic ? Array.from(p.text).map((c) => MIRROR[c] ?? c).join("") : p.text;
    doc.text(shown, cx, y, { lineBreak: false });
    cx += doc.widthOfString(p.text);
  }
}

/** Greedy word wrap on logical text. */
export function wrap(doc: InstanceType<typeof PDFDocument>, text: string, width: number, size: number, bold: boolean, rtl: boolean): string[] {
  const lines: string[] = [];
  for (const para of String(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && widthOf(doc, next, size, bold, rtl) > width) { lines.push(cur); cur = w; } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}
