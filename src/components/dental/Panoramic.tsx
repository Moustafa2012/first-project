"use client";

import { useRef } from "react";
import type { Lang } from "@/lib/i18n";
import { ABSENT_STATUSES, SURFACES, surfaceTone, type Dentition, type Surface } from "@/lib/dental";
import { apexOf, archLayout, mirrorX, panoramicPairs, rootPath, smile, toothShape } from "@/lib/dental-anatomy";
import { toothAriaLabel, type ChartTooth } from "./Odontogram";

const MARGIN = 18, LABEL = 30, SPAN = 120, MID = 8;
const BLOCK_H = LABEL + SPAN + MID + SPAN + LABEL;
const LESION_CODES = new Set(["ABS", "PA", "NEC"]);

/** Surface patches on a crown drawn as a lower tooth (+x mesial). Buccal and lingual face the viewer and the back. */
function surfacePatch(s: Surface, w: number, ch: number) {
  switch (s) {
    case "O": return <rect x={-w / 2 - 2} y={-4} width={w + 4} height={ch * 0.3 + 4} />;
    case "M": return <rect x={0.2 * w} y={ch * 0.2} width={0.32 * w} height={ch * 0.78} />;
    case "D": return <rect x={-0.52 * w} y={ch * 0.2} width={0.32 * w} height={ch * 0.78} />;
    case "B": return <ellipse cx={0} cy={ch * 0.47} rx={0.17 * w} ry={ch * 0.17} />;
    case "L": return <ellipse cx={0} cy={ch * 0.78} rx={0.15 * w} ry={ch * 0.12} opacity={0.7} />;
  }
}

/**
 * The panoramic view: both arches as on a panoramic radiograph (patient's right on the left, upper roots up, a slight
 * "smile" of the occlusal plane), each tooth with its crown, roots, canals and gum line. What is known is drawn where
 * it belongs: caries and fillings on their surfaces, crowns over the crown, root canal fillings in the canals,
 * periapical lesions and abscesses at the apex, implants as a screw, missing teeth as a dashed gap, unerupted and
 * impacted teeth below the gum, recession as a lowered gum line. Schematic: not a radiograph.
 */
export function Panoramic({
  dentition, teeth, lang, selected, onSelect, idPrefix = "pano",
}: {
  dentition: Dentition; teeth: Record<number, ChartTooth>; lang: Lang; selected?: number | null; onSelect?: (t: number) => void; idPrefix?: string;
}) {
  const refs = useRef(new Map<number, SVGGElement>());
  const ar = lang === "ar";
  const pairs = panoramicPairs(dentition);
  const layouts = pairs.map(([u, l]) => [archLayout(u), archLayout(l)] as const);
  const archW = (l: { cx: number; w: number }[]) => (l.length ? l[l.length - 1].cx + l[l.length - 1].w / 2 : 0);
  const W = Math.max(...layouts.flatMap(([u, l]) => [archW(u), archW(l)])) + MARGIN * 2;
  const H = BLOCK_H * pairs.length;
  // every row as absolute x positions, for drawing and for the arrow keys
  const rows = layouts.flatMap(([u, l], bi) => [u, l].map((arch, ai) => {
    const off = MARGIN + (W - MARGIN * 2 - archW(arch)) / 2;
    const occ = bi * BLOCK_H + LABEL + SPAN + (ai === 1 ? MID : 0);
    return { upper: ai === 0, occ, top: bi * BLOCK_H, teeth: arch.map((x) => ({ tooth: x.tooth, cx: off + x.cx, w: x.w })) };
  }));
  const all = rows.flatMap((r) => r.teeth.map((t) => t.tooth));
  const focusable = selected && all.includes(selected) ? selected : all[0];

  const move = (tooth: number, dr: number, di: number) => {
    const r = rows.findIndex((row) => row.teeth.some((x) => x.tooth === tooth));
    const i = rows[r].teeth.findIndex((x) => x.tooth === tooth);
    let target: number | undefined;
    if (di) target = rows[r].teeth[Math.max(0, Math.min(rows[r].teeth.length - 1, i + di))]?.tooth;
    else {
      const nr = r + dr;
      if (nr < 0 || nr >= rows.length) return;
      const x = rows[r].teeth[i].cx;
      target = rows[nr].teeth.reduce((a, b) => (Math.abs(b.cx - x) < Math.abs(a.cx - x) ? b : a)).tooth;
    }
    if (target) refs.current.get(target)?.focus();
  };
  const onKey = (tooth: number) => (e: React.KeyboardEvent<SVGGElement>) => {
    const k = e.key;
    if (k === "ArrowLeft") { e.preventDefault(); move(tooth, 0, -1); }
    else if (k === "ArrowRight") { e.preventDefault(); move(tooth, 0, 1); }
    else if (k === "ArrowUp") { e.preventDefault(); move(tooth, -1, 0); }
    else if (k === "ArrowDown") { e.preventDefault(); move(tooth, 1, 0); }
    else if (k === "Enter" || k === " ") { e.preventDefault(); onSelect?.(tooth); }
  };

  return (
    <div className="pano" dir="ltr">
      <div className="odonto-sides" aria-hidden="true">
        <span>{ar ? "يمين المريض" : "Patient's right"}</span>
        <span>{ar ? "بانوراما تخطيطية — ليست صورة أشعة" : "Schematic panoramic — not a radiograph"}</span>
        <span>{ar ? "يسار المريض" : "Patient's left"}</span>
      </div>
      <div className="odonto-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} className="pano-svg" role="group"
          aria-label={ar ? "مخطط بانورامي للأسنان: يمين المريض على اليسار" : "Panoramic tooth chart: patient's right on the left"}>
          <defs>
            <pattern id={`${idPrefix}-work`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" className="pano-work-bg" /><line x1="0" y1="0" x2="0" y2="4" className="pano-work-line" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={W} height={H} rx="14" className="pano-bg" />
          {rows.map((row, ri) => {
            // the bone around the roots, following the smile of the occlusal plane
            const pts: string[] = [];
            for (let x = MARGIN; x <= W - MARGIN; x += 12) pts.push(`${x},${row.occ + smile(x, W) + (row.upper ? -10 : 10)}`);
            for (let x = W - MARGIN; x >= MARGIN; x -= 12) pts.push(`${x},${row.occ + smile(x, W) + (row.upper ? -SPAN + 6 : SPAN - 6)}`);
            return <polygon key={`bone-${ri}`} points={pts.join(" ")} className="pano-bone" />;
          })}
          <line x1={W / 2} y1={6} x2={W / 2} y2={H - 6} className="pano-mid" />

          {rows.map((row) => row.teeth.map(({ tooth, cx, w }) => {
            const data = teeth[tooth];
            const shape = toothShape(tooth);
            const ch = shape.crownH;
            const status = data?.status ?? null;
            const fs = data?.findings ?? [];
            const kinds = new Set(fs.map((f) => f.kind));
            const problems = data?.links?.problems ?? [];
            const absent = status != null && ABSENT_STATUSES.has(status);
            const pontic = kinds.has("bridge_pontic");
            const implant = kinds.has("implant");
            const rct = kinds.has("root_canal");
            const lesion = kinds.has("periapical_lesion") || kinds.has("abscess") || problems.some((p) => LESION_CODES.has(p.code));
            const recession = kinds.has("recession");
            const eruption = status === "unerupted" ? ch * 1.15 : status === "impacted" ? ch * 0.95 : status === "partially_erupted" ? ch * 0.5 : 0;
            const tilt = status === "impacted" ? 32 : 0;
            const occ = row.occ + smile(cx, W);
            const sy = row.upper ? -1 : 1, sx = mirrorX(tooth);
            const maxL = Math.max(...shape.roots.map((r) => r.length));
            const depth = ch + maxL + eruption + 6;
            const box = row.upper ? { y: occ - depth, h: depth + 6 } : { y: occ - 6, h: depth + 6 };
            const isSel = selected === tooth;
            const clip = `${idPrefix}-clip-${tooth}`;
            const nProc = data?.links?.procedures ?? 0, nImg = data?.links?.images ?? 0;
            const numY = row.upper ? row.top + 13 : row.occ + SPAN + 21;
            const codes = [...new Set(problems.map((p) => p.code))].slice(0, 2).join("·");
            return (
              <g key={tooth} ref={(el) => { if (el) refs.current.set(tooth, el); else refs.current.delete(tooth); }}
                id={`${idPrefix}-${tooth}`} data-tooth={tooth}
                className={`ptooth${status == null && !fs.length && !problems.length ? " nodata" : ""}${problems.length ? " problem" : ""}${isSel ? " sel" : ""}`}
                role="button" tabIndex={tooth === focusable ? 0 : -1} aria-pressed={isSel} aria-label={toothAriaLabel(tooth, data, lang)}
                onClick={() => onSelect?.(tooth)} onKeyDown={onKey(tooth)}>
                <rect x={cx - w / 2} y={box.y} width={w} height={box.h} rx="7" className="ptooth-ring" />
                {problems.length > 0 && <rect x={cx - w / 2 + 1} y={box.y + 1} width={w - 2} height={box.h - 2} rx="7" className="ptooth-problem" />}
                <g transform={`translate(${cx},${occ}) scale(${sx},${sy})`}>
                  <defs><clipPath id={clip}><path d={shape.crown} /></clipPath></defs>
                  {absent ? (
                    <g className="ghost">
                      <path d={shape.crown} />
                      {shape.roots.map((r, i) => <path key={i} d={rootPath(r, ch)} />)}
                    </g>
                  ) : (
                    <g transform={`translate(0,${eruption}) rotate(${tilt},0,${ch})`}>
                      {!pontic && !implant && shape.roots.map((r, i) => (
                        <g key={i}>
                          <path d={rootPath(r, ch)} className="root" />
                          <line x1={r.cx * 0.6} y1={ch * 0.55} x2={r.cx + r.tip * 0.9} y2={ch + r.length - 3} className={`canal${rct ? " rct" : ""}`} />
                        </g>
                      ))}
                      {implant && (
                        <g className="implant">
                          <path d={`M ${-0.17 * w},${ch - 2} L ${0.17 * w},${ch - 2} L ${0.12 * w},${ch + maxL * 0.9} L ${-0.12 * w},${ch + maxL * 0.9} Z`} />
                          {Array.from({ length: 6 }, (_, i) => ch + 5 + i * (maxL * 0.8) / 6).map((y, i) => (
                            <line key={i} x1={-0.19 * w + i * 0.008 * w} y1={y} x2={0.19 * w - i * 0.008 * w} y2={y + 3} className="thread" />
                          ))}
                        </g>
                      )}
                      {kinds.has("post_core") && !implant && <line x1={shape.roots[shape.roots.length - 1].cx * 0.5} y1={ch * 0.35} x2={shape.roots[shape.roots.length - 1].cx} y2={ch + maxL * 0.45} className="post" />}
                      <path d={shape.crown} className="crown" />
                      {!implant && !pontic && <path d={shape.pulp} className="pulp" />}
                      <g clipPath={`url(#${clip})`}>
                        {SURFACES.map((s) => {
                          const tone = surfaceTone(fs, s);
                          if (!tone) return null;
                          return <g key={s} className={`psurf ${tone}`} style={tone === "work" ? { fill: `url(#${idPrefix}-work)` } : undefined}>{surfacePatch(s, shape.w, ch)}</g>;
                        })}
                      </g>
                      {kinds.has("ortho_appliance") && <rect x={-4} y={ch * 0.4} width={8} height={7} className="bracket" />}
                      {lesion && shape.roots.map((r, i) => { const a = apexOf(r, ch); return <circle key={i} cx={a.x} cy={a.y + 3} r={6.5} className="lesion" />; })}
                    </g>
                  )}
                  <path d={`M ${-w / 2},${ch + (recession ? 14 : 4)} Q 0,${ch + (recession ? 7 : -3)} ${w / 2},${ch + (recession ? 14 : 4)}`} className={`gum${recession ? " receded" : ""}`} />
                  {kinds.has("mobility") && !absent && <path d={`M ${-w / 2 - 1},${ch * 0.2} q -3,6 0,12 M ${w / 2 + 1},${ch * 0.2} q 3,6 0,12`} className="mobility" />}
                </g>
                <text x={cx} y={numY} className="ptooth-num">{tooth}</text>
                {codes && <text x={cx} y={row.upper ? numY + 11 : numY - 13} className="ptooth-code">{codes}</text>}
                {nProc > 0 && <circle cx={cx - w / 2 + 5} cy={numY - 4} r="3" className="mk-proc" />}
                {nImg > 0 && <rect x={cx + w / 2 - 9} y={numY - 7} width="6" height="6" rx="1" className="mk-img" />}
              </g>
            );
          }))}
        </svg>
      </div>
    </div>
  );
}

export function PanoLegend({ lang }: { lang: Lang }) {
  const ar = lang === "ar";
  const item = (svg: React.ReactNode, text: string) => <li><svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" className="pano-legend-svg">{svg}</svg>{text}</li>;
  return (
    <ul className="odonto-legend pano-legend">
      {item(<rect x="2" y="2" width="18" height="12" rx="3" className="ptooth-problem" />, ar ? "مشكلة نشطة (تشخيص)" : "Open problem (diagnosis)")}
      {item(<rect x="3" y="3" width="16" height="10" className="psurf disease" />, ar ? "تسوس أو كسر على السطح" : "Caries or fracture on the surface")}
      {item(<rect x="3" y="3" width="16" height="10" className="pano-work-legend" />, ar ? "حشوة أو تاج أو عمل موجود" : "Filling, crown or other work")}
      {item(<line x1="11" y1="1" x2="11" y2="15" className="canal rct" />, ar ? "علاج عصب (حشو القناة)" : "Root canal filling")}
      {item(<circle cx="11" cy="8" r="6" className="lesion" />, ar ? "آفة / خراج عند الذروة" : "Lesion / abscess at the apex")}
      {item(<path d="M 4,8 Q 11,3 18,8" className="gum receded" />, ar ? "خط اللثة (منخفض = انحسار)" : "Gum line (lowered = recession)")}
      {item(<path d="M 5,2 L 17,2 L 15,14 L 7,14 Z" className="ghost-legend" />, ar ? "مفقود / مخلوع" : "Missing / extracted")}
      {item(<path d="M 8,2 L 14,2 L 13,14 L 9,14 Z" className="implant-legend" />, ar ? "زرعة" : "Implant")}
      {item(<circle cx="11" cy="8" r="3.5" className="mk-proc" />, ar ? "إجراء مسجل" : "Procedure recorded")}
      {item(<rect x="8" y="5" width="7" height="7" rx="1" className="mk-img" />, ar ? "صورة / أشعة" : "Image / X-ray")}
      {item(<rect x="3" y="3" width="16" height="10" className="nodata-legend" />, ar ? "لا بيانات فحص (لا يعني سليماً)" : "No exam data (not the same as healthy)")}
    </ul>
  );
}
