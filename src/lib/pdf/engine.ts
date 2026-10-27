import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import { drawLine, FONT_FILES, widthOf, wrap, type FontKey } from "@/lib/pdf/text";

/** Content model shared by every PDF (patient report, shared bundle): the renderer below is the only layout code. */
export type Tone = "ok" | "warn" | "bad" | "info" | "muted";
export type Cell = string | { text: string; tone?: Tone; bold?: boolean };
export type Block =
  | { t: "h"; text: string }
  | { t: "p"; text: string; muted?: boolean }
  | { t: "alert"; tone: Tone; title?: string; text: string }
  | { t: "kv"; rows: [string, string][] }
  | { t: "table"; cols: { label: string; w: number; align?: "start" | "end" }[]; rows: Cell[][] }
  | { t: "chart"; title: string; caption?: string; unit?: string; series: { label: string; pts: { t: number; v: number }[] }[]; refs?: { y: number; label?: string }[]; dateLabel: (ms: number) => string }
  | { t: "space"; h?: number };

export interface ReportMeta {
  lang: "ar" | "en";
  title: string;
  subtitle?: string;
  headline: { name: string; lines: string[] };      // identity block at the top of the first page
  generatedAt: string;                              // already formatted
  footerNote: string;
  brand: string;
}

const C = { ink: "#0f2229", muted: "#546a72", line: "#d5dfe0", brand: "#0b6b63", brandDark: "#073e47", soft: "#eef3f3",
  ok: ["#dcf4e3", "#17612f"], warn: ["#fcebc7", "#7c4500"], bad: ["#fde3e3", "#9b1c1c"], info: ["#dfecfb", "#1b4a85"], muted_: ["#eef3f3", "#546a72"] } as const;
const tonePair = (t: Tone) => (t === "muted" ? C.muted_ : C[t]);
const SERIES = ["#0b6b63", "#b45309", "#1d4ed8", "#9d174d"];

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

export function renderPdf(meta: ReportMeta, blocks: Block[]): Promise<Buffer> {
  const rtl = meta.lang === "ar";
  const doc = new PDFDocument({
    size: "A4", margins: { top: 78, bottom: 56, left: 40, right: 40 }, bufferPages: true, autoFirstPage: false,
    info: { Title: meta.title, Author: meta.brand, Creator: meta.brand, Producer: meta.brand },
    lang: rtl ? "ar" : "en", pdfVersion: "1.7", displayTitle: true,
  });
  for (const k of Object.keys(FONT_FILES) as FontKey[]) doc.registerFont(k, path.join(FONT_DIR, FONT_FILES[k]));

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });

  const L = 40, W = 595.28 - 80, TOP = 78, BOTTOM = 841.89 - 56;
  let y = TOP;
  doc.addPage();

  const text = (s: string, x: number, yy: number, w: number, o: { size?: number; bold?: boolean; color?: string; align?: "start" | "end" | "center" } = {}) =>
    drawLine(doc, s, x, yy, { size: o.size ?? 10, bold: o.bold, rtl, width: w, align: o.align, color: o.color });
  const need = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = TOP; } };

  // ------------------------------------------------------------ identity block (first page)
  const ident = () => {
    doc.save().roundedRect(L, y, W, 18 + 14 * meta.headline.lines.length + 22, 8).fill(C.soft).restore();
    text(meta.headline.name, L + 12, y + 10, W - 24, { size: 17, bold: true });
    meta.headline.lines.forEach((ln, i) => text(ln, L + 12, y + 34 + i * 14, W - 24, { size: 9.5, color: C.muted }));
    y += 18 + 14 * meta.headline.lines.length + 22 + 12;
  };
  ident();

  for (const b of blocks) {
    if (b.t === "space") { y += b.h ?? 8; continue; }
    if (b.t === "h") {
      need(40);
      y += 8;
      text(b.text, L, y, W, { size: 12.5, bold: true, color: C.brandDark });
      y += 18;
      doc.save().moveTo(L, y).lineTo(L + W, y).lineWidth(1).strokeColor(C.brand).stroke().restore();
      y += 8;
      continue;
    }
    if (b.t === "p") {
      const lines = wrap(doc, b.text, W, 9.5, false, rtl);
      for (const ln of lines) { need(14); text(ln, L, y, W, { size: 9.5, color: b.muted ? C.muted : C.ink }); y += 13.5; }
      y += 4;
      continue;
    }
    if (b.t === "alert") {
      const [bg, fg] = tonePair(b.tone);
      const full = (b.title ? `${b.title}: ` : "") + b.text;
      const lines = wrap(doc, full, W - 24, 9.5, false, rtl);
      const h = 14 + lines.length * 13.5;
      need(h + 6);
      doc.save().roundedRect(L, y, W, h, 6).fill(bg).restore();
      doc.save().rect(rtl ? L + W - 4 : L, y, 4, h).fill(fg).restore();
      lines.forEach((ln, i) => text(ln, L + 12, y + 7 + i * 13.5, W - 24, { size: 9.5, color: fg, bold: i === 0 && Boolean(b.title) }));
      y += h + 8;
      continue;
    }
    if (b.t === "kv") {
      const lw = 120;
      for (const [k, v] of b.rows) {
        if (!v) continue;
        const lines = wrap(doc, v, W - lw - 8, 9.5, false, rtl);
        const h = Math.max(14, lines.length * 13.5);
        need(h);
        text(k, rtl ? L + W - lw : L, y, lw, { size: 9, color: C.muted });
        lines.forEach((ln, i) => text(ln, rtl ? L : L + lw + 8, y + i * 13.5, W - lw - 8, { size: 9.5 }));
        y += h + 2;
      }
      y += 4;
      continue;
    }
    if (b.t === "table") {
      const total = b.cols.reduce((n, c) => n + c.w, 0);
      const cols = b.cols.map((c) => ({ ...c, pw: (c.w / total) * W }));
      const ordered = rtl ? [...cols].reverse().map((c, i, arr) => ({ ...c, idx: cols.indexOf(c), i, n: arr.length })) : cols.map((c, i) => ({ ...c, idx: i }));
      const xOf = (pos: number) => L + ordered.slice(0, pos).reduce((n, c) => n + c.pw, 0);
      const header = () => {
        need(22);
        doc.save().rect(L, y, W, 18).fill(C.soft).restore();
        ordered.forEach((c, pos) => text(c.label, xOf(pos) + 4, y + 4.5, c.pw - 8, { size: 8.5, bold: true, color: C.muted, align: c.align }));
        y += 20;
      };
      need(70);
      header();
      for (const row of b.rows) {
        const cellLines = ordered.map((c) => {
          const cell = row[c.idx];
          const s = typeof cell === "string" ? cell : cell?.text ?? "";
          return wrap(doc, s, c.pw - 8, 9, typeof cell === "object" && Boolean(cell?.bold), rtl);
        });
        const h = Math.max(...cellLines.map((l) => l.length)) * 12.5 + 6;
        if (y + h > BOTTOM) { doc.addPage(); y = TOP; header(); }
        ordered.forEach((c, pos) => {
          const cell = row[c.idx];
          const tone = typeof cell === "object" ? cell?.tone : undefined;
          const bold = typeof cell === "object" && Boolean(cell?.bold);
          if (tone && tone !== "muted") {
            const [bg, fg] = tonePair(tone);
            const w = Math.min(c.pw - 6, Math.max(...cellLines[pos].map((s) => widthOf(doc, s, 9, true, rtl))) + 10);
            doc.save().roundedRect(rtl ? xOf(pos) + c.pw - 3 - w : xOf(pos) + 3, y + 1, w, h - 3, 7).fill(bg).restore();
            cellLines[pos].forEach((ln, i) => text(ln, xOf(pos) + 4, y + 3 + i * 12.5, c.pw - 8, { size: 9, bold: true, color: fg, align: c.align }));
          } else {
            cellLines[pos].forEach((ln, i) => text(ln, xOf(pos) + 4, y + 3 + i * 12.5, c.pw - 8, { size: 9, bold, color: tone === "muted" ? C.muted : C.ink, align: c.align }));
          }
        });
        y += h;
        doc.save().moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.line).stroke().restore();
      }
      y += 8;
      continue;
    }
    if (b.t === "chart") {
      const H = 150, PADL = 38, PADB = 20;
      need(H + 50);
      text(b.title, L, y, W, { size: 10, bold: true });
      y += b.caption ? 13 : 16;
      if (b.caption) { text(b.caption, L, y, W, { size: 8, color: C.muted }); y += 14; }
      const pts = b.series.flatMap((s) => s.pts);
      if (pts.length < 2) { text("—", L, y, W, { size: 9, color: C.muted }); y += 16; continue; }
      const xs = pts.map((p) => p.t), vs = [...pts.map((p) => p.v), ...(b.refs ?? []).map((r) => r.y)];
      const x0 = Math.min(...xs), x1 = Math.max(...xs) === Math.min(...xs) ? Math.min(...xs) + 1 : Math.max(...xs);
      let lo = Math.min(...vs), hi = Math.max(...vs);
      if (hi === lo) { hi += 1; lo -= 1; }
      const padv = (hi - lo) * 0.08; lo -= padv; hi += padv;
      const px = L + PADL, pw = W - PADL - 8, py = y, ph = H - PADB;
      const X = (t: number) => px + ((t - x0) / (x1 - x0)) * pw;
      const Y = (v: number) => py + ph - ((v - lo) / (hi - lo)) * ph;
      doc.save().lineWidth(0.5).strokeColor(C.line);
      for (let i = 0; i <= 4; i++) {
        const v = lo + ((hi - lo) * i) / 4; const yy = Y(v);
        doc.moveTo(px, yy).lineTo(px + pw, yy).stroke();
        doc.font("la").fontSize(7.5).fillColor(C.muted).text(String(Math.round(v * 10) / 10), L, yy - 4, { width: PADL - 5, align: "right", lineBreak: false });
      }
      doc.restore();
      for (const r of b.refs ?? []) {
        doc.save().dash(3, { space: 3 }).lineWidth(0.8).strokeColor("#8a9aa1").moveTo(px, Y(r.y)).lineTo(px + pw, Y(r.y)).stroke().undash().restore();
        if (r.label) doc.font("la").fontSize(7).fillColor(C.muted).text(r.label, px + 2, Y(r.y) - 9, { lineBreak: false });
      }
      b.series.forEach((s, si) => {
        const col = SERIES[si % SERIES.length];
        const sp = [...s.pts].sort((a, c) => a.t - c.t);
        if (sp.length >= 2) {
          doc.save().lineWidth(1.6).lineJoin("round").lineCap("round").strokeColor(col);
          sp.forEach((p, i) => (i ? doc.lineTo(X(p.t), Y(p.v)) : doc.moveTo(X(p.t), Y(p.v))));
          doc.stroke().restore();
        }
        for (const p of sp) doc.save().circle(X(p.t), Y(p.v), 2.2).fillAndStroke(col, "#ffffff").restore();
      });
      const startLabel = b.dateLabel(x0), endLabel = b.dateLabel(x1);
      drawLine(doc, startLabel, px, py + ph + 6, { size: 7.5, rtl, width: 120, align: rtl ? "end" : "start", color: C.muted });
      drawLine(doc, endLabel, px + pw - 120, py + ph + 6, { size: 7.5, rtl, width: 120, align: rtl ? "start" : "end", color: C.muted });
      y = py + H + 6;
      // legend
      if (b.series.length > 1 || b.unit) {
        let lx = L + PADL;
        b.series.forEach((s, si) => {
          doc.save().rect(lx, y + 4, 12, 3).fill(SERIES[si % SERIES.length]).restore();
          const lab = s.label;
          const lw = widthOf(doc, lab, 8, false, rtl) + 2;
          drawLine(doc, lab, lx + 16, y, { size: 8, rtl, width: lw, align: "start", color: C.muted });
          lx += 28 + lw;
        });
        y += 14;
      }
      y += 6;
      continue;
    }
  }

  // ------------------------------------------------------------ header + footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // brand mark (vector)
    const mx = rtl ? L + W - 26 : L, my = 22;
    doc.save();
    doc.roundedRect(mx, my, 26, 26, 7).fill(C.brand);
    doc.translate(mx, my).scale(26 / 32);
    doc.path("M16 5.5l8.2 3v7.2c0 5.1-3.5 8.6-8.2 10.8-4.7-2.2-8.2-5.7-8.2-10.8V8.5z").fill("#ffffff");
    doc.path("M10.8 16.2h3.2l1.6-3.6 2.4 7 1.7-3.4h1.7").lineWidth(1.8).lineCap("round").lineJoin("round").stroke(C.brand);
    doc.restore();
    const tx = rtl ? L : L + 34, tw = W - 34;
    drawLine(doc, meta.brand, tx, 22, { size: 11, bold: true, rtl, width: tw, align: rtl ? "start" : "start", color: C.brandDark });
    drawLine(doc, meta.title + (meta.subtitle ? ` — ${meta.subtitle}` : ""), tx, 37, { size: 8.5, rtl, width: tw, color: C.muted });
    doc.save().moveTo(L, 62).lineTo(L + W, 62).lineWidth(0.8).strokeColor(C.line).stroke().restore();
    doc.save().moveTo(L, 841.89 - 44).lineTo(L + W, 841.89 - 44).lineWidth(0.5).strokeColor(C.line).stroke().restore();
    const prevBottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;     // allow drawing inside the footer margin
    wrap(doc, meta.footerNote, W - 70, 7, false, rtl).slice(0, 2).forEach((ln, k) => drawLine(doc, ln, L, 841.89 - 40 + k * 9, { size: 7, rtl, width: W - 70, color: C.muted }));
    doc.font("la").fontSize(8).fillColor(C.muted);
    const pg = `${i - range.start + 1} / ${range.count}`;
    doc.text(pg, rtl ? L : L + W - doc.widthOfString(pg), 841.89 - 40, { lineBreak: false });
    drawLine(doc, meta.generatedAt, L, 841.89 - 20, { size: 7, rtl, width: W, color: C.muted });
    doc.page.margins.bottom = prevBottom;
  }
  doc.end();
  return done;
}
