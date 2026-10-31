import { isPatientRight, isPrimary, isUpper, toothType, type Dentition, ARCHES } from "@/lib/dental";

/**
 * Schematic anatomy for the panoramic chart. Each tooth is described in its own coordinates, drawn as a LOWER tooth:
 * the occlusal / incisal edge at y = 0, the crown down to the cemento-enamel junction (y = crownH), the roots below it
 * to their apices; +x is MESIAL (towards the midline). The chart mirrors the shape for upper teeth (roots up) and for
 * teeth on the patient's left (mesial to the left). Root numbers follow the usual anatomy; the drawing is schematic,
 * not a radiograph.
 */
export interface RootShape { cx: number; width: number; length: number; tip: number }
export interface ToothShape { w: number; crownH: number; roots: RootShape[]; crown: string; pulp: string }

function crownPath(type: string, w: number, ch: number): string {
  switch (type) {
    case "incisor":
      return `M ${-0.42 * w},2 Q 0,-1 ${0.42 * w},2 Q ${0.5 * w},${ch * 0.5} ${0.31 * w},${ch} L ${-0.31 * w},${ch} Q ${-0.5 * w},${ch * 0.5} ${-0.42 * w},2 Z`;
    case "canine":
      return `M ${-0.44 * w},7 L ${0.04 * w},-2 L ${0.44 * w},7 Q ${0.5 * w},${ch * 0.52} ${0.33 * w},${ch} L ${-0.33 * w},${ch} Q ${-0.5 * w},${ch * 0.52} ${-0.44 * w},7 Z`;
    case "premolar":
      return `M ${-0.45 * w},5 Q ${-0.23 * w},-3 0,3 Q ${0.23 * w},-3 ${0.45 * w},5 Q ${0.52 * w},${ch * 0.55} ${0.32 * w},${ch} L ${-0.32 * w},${ch} Q ${-0.52 * w},${ch * 0.55} ${-0.45 * w},5 Z`;
    default: // molar
      return `M ${-0.47 * w},6 Q ${-0.32 * w},-3 ${-0.16 * w},3 Q 0,-3 ${0.16 * w},3 Q ${0.32 * w},-3 ${0.47 * w},6 Q ${0.52 * w},${ch * 0.6} ${0.38 * w},${ch} L ${-0.38 * w},${ch} Q ${-0.52 * w},${ch * 0.6} ${-0.47 * w},6 Z`;
  }
}

/** Number and shape of the roots: incisors, canines and most premolars one; the upper first premolar two; upper molars three; lower molars two. */
export function rootsOf(tooth: number, w: number, L: number): RootShape[] {
  const type = toothType(tooth), u = tooth % 10, upper = isUpper(tooth), primary = isPrimary(tooth);
  if (type === "molar") {
    const l = primary ? L * 0.8 : L;
    if (upper) return [
      { cx: 0.02 * w, width: 0.24 * w, length: l * 0.86, tip: 0 },               // palatal (behind)
      { cx: -0.27 * w, width: 0.26 * w, length: l, tip: -0.08 * w },             // distobuccal
      { cx: 0.27 * w, width: 0.27 * w, length: l, tip: 0.05 * w },               // mesiobuccal
    ];
    return [
      { cx: -0.25 * w, width: 0.3 * w, length: l * 0.95, tip: -0.07 * w },       // distal
      { cx: 0.25 * w, width: 0.31 * w, length: l, tip: 0.03 * w },               // mesial
    ];
  }
  if (type === "premolar" && upper && u === 4) return [
    { cx: -0.15 * w, width: 0.3 * w, length: L, tip: -0.04 * w },
    { cx: 0.15 * w, width: 0.3 * w, length: L, tip: 0.04 * w },
  ];
  return [{ cx: 0, width: (type === "canine" ? 0.5 : 0.48) * w, length: L, tip: 0 }];
}

export function toothShape(tooth: number): ToothShape {
  const type = toothType(tooth), u = tooth % 10, primary = isPrimary(tooth), upper = isUpper(tooth);
  const k = primary ? 0.78 : 1;
  let w: number, ch: number, L: number;
  if (type === "incisor") { w = (u === 1 ? (upper ? 34 : 26) : (upper ? 28 : 27)) * k; ch = 36 * k; L = (upper ? 48 : 44) * k; }
  else if (type === "canine") { w = 31 * k; ch = 40 * k; L = 62 * k; }
  else if (type === "premolar") { w = 31; ch = 34; L = 48; }
  else { w = (u === 8 ? 38 : 44) * k; ch = 30 * k; L = (u === 8 ? 36 : 42) * k; }
  const crown = crownPath(type, w, ch);
  const pulp = `M ${-0.13 * w},${ch * 0.5} Q 0,${ch * 0.32} ${0.13 * w},${ch * 0.5} L ${0.1 * w},${ch + 2} L ${-0.1 * w},${ch + 2} Z`;
  return { w, crownH: ch, roots: rootsOf(tooth, w, L), crown, pulp };
}

/** Path of one root, from the cemento-enamel junction to the apex. */
export function rootPath(r: RootShape, ch: number): string {
  const a = r.cx - r.width / 2, b = r.cx + r.width / 2, ax = r.cx + r.tip, ay = ch + r.length;
  return `M ${a},${ch - 1} Q ${a - 1},${ch + r.length * 0.62} ${ax},${ay} Q ${b + 1},${ch + r.length * 0.62} ${b},${ch - 1} Z`;
}
export const apexOf = (r: RootShape, ch: number) => ({ x: r.cx + r.tip, y: ch + r.length });

/** Where each tooth of an arch sits: centre x and width, the patient's right on the left, a gap at the midline. */
export function archLayout(arch: number[], gap = 10): { tooth: number; cx: number; w: number }[] {
  const widths = arch.map((t) => toothShape(t).w + 4);
  const half = arch.length / 2;
  let x = 0;
  return arch.map((tooth, i) => {
    if (i === half) x += gap;
    const cx = x + widths[i] / 2;
    x += widths[i];
    return { tooth, cx, w: widths[i] };
  });
}

/** The arches drawn as panoramic pairs (upper over lower): one pair, or two for a mixed dentition. */
export function panoramicPairs(d: Dentition): [number[], number[]][] {
  if (d === "primary") return [[ARCHES.primaryUpper, ARCHES.primaryLower]];
  if (d === "mixed") return [[ARCHES.permanentUpper, ARCHES.permanentLower], [ARCHES.primaryUpper, ARCHES.primaryLower]];
  return [[ARCHES.permanentUpper, ARCHES.permanentLower]];
}

/** The "smile" of a panoramic image: the occlusal plane rises towards the back teeth. */
export const smile = (cx: number, width: number, depth = 14) => {
  const t = (cx - width / 2) / (width / 2);
  return -depth * t * t;
};

export const mirrorX = (tooth: number) => (isPatientRight(tooth) ? 1 : -1);
