import type { Lang } from "@/lib/i18n";

/**
 * Dental images: whole-mouth images, the structured bone-level reading per sextant, and the annotations drawn over an
 * image. The database checks the same rules (migration 0025: app.is_whole_mouth, app.bone_levels_ok,
 * app.annotation_shapes_ok); tests/dental-imaging.test.ts reads that file and checks the two agree.
 */

type L = [string, string];
const pick = (l: L, lang: Lang) => (lang === "ar" ? l[0] : l[1]);

// ---------------------------------------------------------------- whole-mouth images
export const WHOLE_MOUTH_MODALITIES = ["panoramic", "cbct", "cephalometric"] as const;
/** a panoramic, CBCT or cephalometric image that names no tooth: it concerns the whole mouth and shows on every tooth */
export function isWholeMouth(modality: string | null | undefined, teeth: readonly number[] | null | undefined): boolean {
  return (WHOLE_MOUTH_MODALITIES as readonly string[]).includes(modality ?? "") && !(teeth && teeth.length > 0);
}

// ---------------------------------------------------------------- the bone level, read per sextant
export type SextantKey = "s1" | "s2" | "s3" | "s4" | "s5" | "s6";
/** the sextants of the permanent dentition: FDI numbers in the order they lie, and a short name */
export const SEXTANTS: { key: SextantKey; teeth: number[]; label: L }[] = [
  { key: "s1", teeth: [18, 17, 16, 15, 14], label: ["علوي أيمن (18–14)", "Upper right (18–14)"] },
  { key: "s2", teeth: [13, 12, 11, 21, 22, 23], label: ["علوي أمامي (13–23)", "Upper anterior (13–23)"] },
  { key: "s3", teeth: [24, 25, 26, 27, 28], label: ["علوي أيسر (24–28)", "Upper left (24–28)"] },
  { key: "s4", teeth: [38, 37, 36, 35, 34], label: ["سفلي أيسر (38–34)", "Lower left (38–34)"] },
  { key: "s5", teeth: [33, 32, 31, 41, 42, 43], label: ["سفلي أمامي (33–43)", "Lower anterior (33–43)"] },
  { key: "s6", teeth: [44, 45, 46, 47, 48], label: ["سفلي أيمن (44–48)", "Lower right (44–48)"] },
];
export const BONE_LEVELS: [string, L][] = [
  ["none", ["لا فقد عظم ملحوظ", "No visible bone loss"]],
  ["coronal15", ["أقل من 15% (بداية)", "Under 15% (initial)"]],
  ["coronal_third", ["الثلث التاجي (15–33%)", "Coronal third (15–33%)"]],
  ["middle_third", ["الثلث الأوسط", "Middle third"]],
  ["apical_third", ["الثلث الذروي", "Apical third"]],
];
export const BONE_PATTERNS: [string, L][] = [
  ["horizontal", ["أفقي", "Horizontal"]], ["vertical", ["عمودي (زاوي)", "Vertical (angular)"]], ["mixed", ["مختلط", "Mixed"]],
];
export interface BoneSextant { level: string; pattern?: string }
export type BoneLevels = Partial<Record<SextantKey, BoneSextant>>;

const levelLabel = (v: string, lang: Lang) => BONE_LEVELS.find(([k]) => k === v)?.[1] ?? [v, v];
const patternLabel = (v: string, lang: Lang) => BONE_PATTERNS.find(([k]) => k === v)?.[1] ?? [v, v];

/** Reads a bone reading from stored JSON (or null); `error` when it is not a valid reading. An empty reading is null. */
export function parseBoneLevels(raw: unknown): { levels: BoneLevels | null } | { error: true } {
  if (raw == null || raw === "") return { levels: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: true };
  const out: BoneLevels = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SEXTANTS.some((s) => s.key === k) || typeof v !== "object" || v === null || Array.isArray(v)) return { error: true };
    const o = v as Record<string, unknown>;
    if (Object.keys(o).some((x) => x !== "level" && x !== "pattern")) return { error: true };
    if (typeof o.level !== "string" || !BONE_LEVELS.some(([x]) => x === o.level)) return { error: true };
    if (o.pattern !== undefined && (typeof o.pattern !== "string" || !BONE_PATTERNS.some(([x]) => x === o.pattern))) return { error: true };
    out[k as SextantKey] = { level: o.level, ...(o.pattern ? { pattern: o.pattern as string } : {}) };
  }
  return { levels: Object.keys(out).length ? out : null };
}

/** The form: `bone_<s>_level` and `bone_<s>_pattern` for each sextant (blank = not read). */
export function boneLevelsFromForm(get: (name: string) => string): { levels: BoneLevels | null } | { error: true } {
  const raw: Record<string, unknown> = {};
  for (const s of SEXTANTS) {
    const level = get(`bone_${s.key}_level`).trim(), pattern = get(`bone_${s.key}_pattern`).trim();
    if (!level) { if (pattern) return { error: true }; continue; }
    raw[s.key] = { level, ...(pattern ? { pattern } : {}) };
  }
  return parseBoneLevels(raw);
}

/** the sextant (s1…s6) a permanent tooth belongs to; null for primary teeth */
export function sextantOf(tooth: number): SextantKey | null {
  return SEXTANTS.find((s) => s.teeth.includes(tooth))?.key ?? null;
}

const SEVERITY = new Map(BONE_LEVELS.map(([k], i) => [k, i]));
/** the most advanced level read in any sextant (null when nothing was read) */
export function worstBoneLevel(levels: BoneLevels | null | undefined): string | null {
  let worst: string | null = null;
  for (const v of Object.values(levels ?? {})) if (!worst || (SEVERITY.get(v.level) ?? 0) > (SEVERITY.get(worst) ?? 0)) worst = v.level;
  return worst;
}

/** "S1 coronal third (horizontal) · S4 middle third (vertical)": the reading in one line */
export function summarizeBoneLevels(levels: BoneLevels | null | undefined, lang: Lang): string {
  const parts: string[] = [];
  for (const s of SEXTANTS) {
    const v = levels?.[s.key];
    if (!v) continue;
    const name = pick(levelLabel(v.level, lang), lang);
    parts.push(`${s.key.toUpperCase()} ${name}${v.pattern ? ` (${pick(patternLabel(v.pattern, lang), lang)})` : ""}`);
  }
  return parts.join(" · ");
}
export { levelLabel as boneLevelLabel, patternLabel as bonePatternLabel };

// ---------------------------------------------------------------- annotations
export type AnnotationColor = "red" | "yellow" | "green" | "blue" | "white";
export const ANNOTATION_COLORS: AnnotationColor[] = ["red", "yellow", "green", "blue", "white"];
/** Coordinates are fractions (0–1) of the image width and height, so a shape follows any zoom or screen. */
export type Shape =
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number; color?: AnnotationColor }
  | { type: "circle"; cx: number; cy: number; r: number; color?: AnnotationColor }
  | { type: "rect"; x: number; y: number; w: number; h: number; color?: AnnotationColor }
  | { type: "text"; x: number; y: number; text: string; color?: AnnotationColor };
export const SHAPE_KEYS: Record<Shape["type"], string[]> = {
  arrow: ["x1", "y1", "x2", "y2"], circle: ["cx", "cy", "r"], rect: ["x", "y", "w", "h"], text: ["x", "y", "text"],
};
export const MAX_SHAPES = 50;
export const MAX_TEXT = 200;

/** Validates shapes (as the database does). Returns the cleaned list or an error. */
export function parseShapes(raw: unknown): { shapes: Shape[] } | { error: true } {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SHAPES) return { error: true };
  const out: Shape[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null || Array.isArray(s)) return { error: true };
    const o = s as Record<string, unknown>;
    const keys = typeof o.type === "string" ? SHAPE_KEYS[o.type as Shape["type"]] : undefined;
    if (!keys) return { error: true };
    for (const k of Object.keys(o)) if (k !== "type" && k !== "color" && !keys.includes(k)) return { error: true };
    if (o.color !== undefined && !ANNOTATION_COLORS.includes(o.color as AnnotationColor)) return { error: true };
    for (const k of keys) {
      const v = o[k];
      if (k === "text") {
        if (typeof v !== "string" || v.trim().length < 1 || v.trim().length > MAX_TEXT) return { error: true };
      } else {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return { error: true };
        if ((k === "r" || k === "w" || k === "h") && v === 0) return { error: true };
      }
    }
    const clean: Record<string, unknown> = { type: o.type };
    for (const k of keys) clean[k] = k === "text" ? String(o[k]).trim() : round(o[k] as number);
    if (o.color) clean.color = o.color;
    out.push(clean as unknown as Shape);
  }
  return { shapes: out };
}
const round = (n: number) => Math.round(n * 10000) / 10000;

export interface AnnotationRow {
  id: string; imaging_id: string; document_id: string; shapes: Shape[]; recorded_at?: string | null;
  contributed_by?: string | null; by?: string | null; mine?: boolean;
}

// ---------------------------------------------------------------- the viewer's geometry (pure, so it can be tested)
export interface View { zoom: number; rotate: number; tx: number; ty: number }
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 12;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const INITIAL_VIEW: View = { zoom: 1, rotate: 0, tx: 0, ty: 0 };

/**
 * A point on the screen (relative to the centre of the viewport) -> the image's normalised coordinates (0–1), given the
 * image box (w × h pixels at zoom 1, centred in the viewport) and the view (translate, then rotate, then scale about its centre).
 */
export function toNormalized(px: number, py: number, box: { w: number; h: number }, v: View): { x: number; y: number } {
  const qx = px - v.tx, qy = py - v.ty;
  const a = (-v.rotate * Math.PI) / 180;
  const lx = (qx * Math.cos(a) - qy * Math.sin(a)) / v.zoom, ly = (qx * Math.sin(a) + qy * Math.cos(a)) / v.zoom;
  return { x: lx / box.w + 0.5, y: ly / box.h + 0.5 };
}
/** zooms by `factor` keeping the screen point (relative to the viewport centre) fixed */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { ...v, zoom, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
}
export const rotateBy = (v: View, deg: number): View => ({ ...v, rotate: (((v.rotate + deg) % 360) + 360) % 360 });
export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
