import type { Lang } from "@/lib/i18n";
import { ARCHES, isFdi, isPatientRight, isUpper } from "@/lib/dental";

/**
 * Periodontal chart logic shared by the page, the PDF and the tests.
 *
 * Six sites per tooth, stored in a fixed order: 0 distobuccal, 1 buccal, 2 mesiobuccal, 3 distolingual, 4 lingual, 5 mesiolingual.
 * Gingival margin (gm) sign: positive = margin coronal to the CEJ (overgrowth), 0 = at the CEJ (also assumed when not measured),
 * negative = recession apical to the CEJ. Clinical attachment level: CAL = PD − GM (the database computes the same).
 */

export type Site = 0 | 1 | 2 | 3 | 4 | 5;
export const SITES: Site[] = [0, 1, 2, 3, 4, 5];
export const PD_MAX = 20;
export const GM_MIN = -15;
export const GM_MAX = 15;
export type Furcation = "b" | "l" | "m" | "d";
export type Six<T> = (T | null)[];

export interface PerioTooth {
  tooth: number;
  missing: boolean;
  implant: boolean;
  mobility: number | null;
  furcation_b: number | null; furcation_l: number | null; furcation_m: number | null; furcation_d: number | null;
  pd: Six<number> | null;
  gm: Six<number> | null;
  bop: Six<boolean> | null;
  plaque: Six<boolean> | null;
  suppuration: Six<boolean> | null;
  cal?: Six<number> | null;
  note?: string | null;
}
export interface PerioExam {
  id: string; exam_date: string; status: "draft" | "final"; examiner_name?: string | null; facility_name?: string | null; notes?: string | null;
  finalized_at?: string | null; recorded_at?: string | null; record_status?: string; invalidated_reason?: string | null; teeth: PerioTooth[];
}

/** permanent teeth, as seen when facing the patient */
export const PERIO_ARCHES = { upper: ARCHES.permanentUpper, lower: ARCHES.permanentLower };

export const emptyTooth = (tooth: number): PerioTooth => ({
  tooth, missing: false, implant: false, mobility: null, furcation_b: null, furcation_l: null, furcation_m: null, furcation_d: null,
  pd: null, gm: null, bop: null, plaque: null, suppuration: null, note: null,
});

// ---------------------------------------------------------------- anatomy
/** the furcation entrances charted on this tooth: upper molars b/m/d, lower molars b/l, upper first premolars m/d */
export function furcationsOf(tooth: number): Furcation[] {
  const u = tooth % 10, q = Math.floor(tooth / 10);
  if (q < 1 || q > 4) return [];
  if (u >= 6) return isUpper(tooth) ? ["b", "m", "d"] : ["b", "l"];
  if (u === 4 && isUpper(tooth)) return ["m", "d"];
  return [];
}

/** the order in which a side's three sites are drawn left→right when facing the patient */
export function sideOrder(tooth: number, side: "buccal" | "lingual"): Site[] {
  const base: Site[] = side === "buccal" ? [0, 1, 2] : [3, 4, 5];
  // on the patient's right the distal site is on the viewer's left; on the left side it is the other way round
  return isPatientRight(tooth) ? base : [...base].reverse() as Site[];
}

export function siteName(site: Site, tooth: number, lang: Lang): string {
  const front = tooth % 10 <= 3, upper = isUpper(tooth), buccal = site <= 2;
  const pos = site % 3; // 0 distal, 1 mid, 2 mesial
  if (lang === "ar") {
    const face = buccal ? (front ? "شفوي" : "خدّي") : (upper ? "حنكي" : "لساني");
    return pos === 1 ? face : `${pos === 0 ? "وحشي" : "أنسي"}-${face}`;
  }
  const face = buccal ? (front ? "labial" : "buccal") : (upper ? "palatal" : "lingual");
  return pos === 1 ? face : `${pos === 0 ? "disto" : "mesio"}${face}`;
}
export function sideName(tooth: number, side: "buccal" | "lingual", lang: Lang): string {
  if (side === "buccal") return lang === "ar" ? "الدهليزي (الخدّي/الشفوي)" : "Buccal / labial";
  return isUpper(tooth) ? (lang === "ar" ? "الحنكي" : "Palatal") : (lang === "ar" ? "اللساني" : "Lingual");
}

// ---------------------------------------------------------------- numbers
export function calAt(pd: number | null | undefined, gm: number | null | undefined): number | null {
  return pd === null || pd === undefined ? null : pd - (gm ?? 0);
}
export function calOf(t: Pick<PerioTooth, "pd" | "gm">): Six<number> | null {
  if (!t.pd) return null;
  return SITES.map((i) => calAt(t.pd?.[i], t.gm?.[i]));
}
/** colour band of a probing depth: up to 3 mm healthy, 4–5 moderate, 6+ deep */
export function depthTone(pd: number | null | undefined): "ok" | "warn" | "deep" | null {
  if (pd === null || pd === undefined) return null;
  return pd >= 6 ? "deep" : pd >= 4 ? "warn" : "ok";
}

export interface PerioSummary {
  teeth: number; missing: number; implants: number; sites: number;
  bop: number; bopPct: number | null; plaque: number; plaquePct: number | null; suppuration: number;
  pd4: number; pd6: number; meanPd: number | null; meanCal: number | null; maxCal: number | null;
  mobile: number; furcations: number;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** the figures shown above a chart and in the PDF; percentages are over the probed sites */
export function summarize(teeth: PerioTooth[]): PerioSummary {
  let sites = 0, bop = 0, plaque = 0, supp = 0, pd4 = 0, pd6 = 0, sumPd = 0, sumCal = 0, nCal = 0, maxCal: number | null = null;
  let mobile = 0, furc = 0, present = 0, missing = 0, implants = 0;
  for (const t of teeth) {
    if (t.missing) { missing++; continue; }
    const probed = !!t.pd?.some((v) => v !== null && v !== undefined);
    if (probed || t.mobility !== null || t.bop || t.plaque) present++;
    if (t.implant) implants++;
    if ((t.mobility ?? 0) > 0) mobile++;
    if ([t.furcation_b, t.furcation_l, t.furcation_m, t.furcation_d].some((f) => (f ?? 0) > 0)) furc++;
    const cal = calOf(t);
    for (const i of SITES) {
      const pd = t.pd?.[i];
      if (pd === null || pd === undefined) continue;
      sites++; sumPd += pd;
      if (pd >= 4) pd4++;
      if (pd >= 6) pd6++;
      if (t.bop?.[i]) bop++;
      if (t.plaque?.[i]) plaque++;
      if (t.suppuration?.[i]) supp++;
      const c = cal?.[i];
      if (c !== null && c !== undefined) { sumCal += c; nCal++; maxCal = maxCal === null ? c : Math.max(maxCal, c); }
    }
  }
  const pct = (n: number) => (sites ? Math.round((n / sites) * 100) : null);
  return {
    teeth: present, missing, implants, sites, bop, bopPct: pct(bop), plaque, plaquePct: pct(plaque), suppuration: supp, pd4, pd6,
    meanPd: sites ? round1(sumPd / sites) : null, meanCal: nCal ? round1(sumCal / nCal) : null, maxCal, mobile, furcations: furc,
  };
}

// ---------------------------------------------------------------- comparing two charts
export interface SiteChange { tooth: number; site: Site; pdBefore: number; pdAfter: number; calBefore: number; calAfter: number; dCal: number; dPd: number }
export interface PerioComparison {
  worse: SiteChange[]; better: SiteChange[]; lostTeeth: number[]; before: PerioSummary; after: PerioSummary;
}
/**
 * Sites probed in both charts. A change of 2 mm or more in attachment counts (smaller changes are within probing error);
 * a site counts as better when its probing depth fell by 2 mm or more.
 */
export function comparePerio(before: PerioTooth[], after: PerioTooth[], threshold = 2): PerioComparison {
  const a = new Map(before.map((t) => [t.tooth, t]));
  const worse: SiteChange[] = [], better: SiteChange[] = [], lostTeeth: number[] = [];
  for (const t2 of after) {
    const t1 = a.get(t2.tooth);
    if (!t1) continue;
    if (!t1.missing && t2.missing) { lostTeeth.push(t2.tooth); continue; }
    if (t1.missing || t2.missing) continue;
    const c1 = calOf(t1), c2 = calOf(t2);
    for (const i of SITES) {
      const p1 = t1.pd?.[i], p2 = t2.pd?.[i], k1 = c1?.[i], k2 = c2?.[i];
      if (p1 == null || p2 == null || k1 == null || k2 == null) continue;
      const ch: SiteChange = { tooth: t2.tooth, site: i, pdBefore: p1, pdAfter: p2, calBefore: k1, calAfter: k2, dCal: k2 - k1, dPd: p2 - p1 };
      if (ch.dCal >= threshold) worse.push(ch);
      else if (ch.dPd <= -threshold) better.push(ch);
    }
  }
  const order = (x: SiteChange, y: SiteChange) => x.tooth - y.tooth || x.site - y.site;
  return { worse: worse.sort(order), better: better.sort(order), lostTeeth: lostTeeth.sort((x, y) => x - y), before: summarize(before), after: summarize(after) };
}

// ---------------------------------------------------------------- the payload sent by the chart
const intIn = (v: unknown, lo: number, hi: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
};
function six<T>(raw: unknown, conv: (v: unknown) => T | null | typeof NaN): Six<T> | null | "bad" {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length !== 6) return "bad";
  const out = raw.map(conv) as (T | null)[];
  if (out.some((v) => typeof v === "number" && Number.isNaN(v))) return "bad";
  return out.every((v) => v === null || v === false) ? null : out;
}
const flag = (v: unknown) => (v === true ? true : v === false || v === null || v === undefined ? false : NaN);

/**
 * Checks the chart sent by the browser (the database checks it again). Empty sides become null; a missing tooth keeps
 * no measurements; furcations only where the tooth has them. Returns the teeth to save or an error key.
 */
export function parsePerioTeeth(json: string): { teeth: PerioTooth[] } | { error: "invalid" | "range" } {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { error: "invalid" }; }
  if (!Array.isArray(raw) || raw.length > 32) return { error: "invalid" };
  const seen = new Set<number>();
  const teeth: PerioTooth[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return { error: "invalid" };
    const tooth = Number(r.tooth);
    if (!isFdi(tooth) || tooth >= 50 || seen.has(tooth)) return { error: "invalid" };
    seen.add(tooth);
    const t = emptyTooth(tooth);
    t.missing = r.missing === true;
    t.implant = !t.missing && r.implant === true;
    if (!t.missing) {
      const pd = six<number>(r.pd, (v) => intIn(v, 0, PD_MAX));
      const gm = six<number>(r.gm, (v) => intIn(v, GM_MIN, GM_MAX));
      const bop = six<boolean>(r.bop, flag), plaque = six<boolean>(r.plaque, flag), supp = six<boolean>(r.suppuration, flag);
      const mob = intIn(r.mobility, 0, 3);
      if ([pd, gm, bop, plaque, supp].includes("bad") || Number.isNaN(mob)) return { error: "range" };
      // a side with only nulls is no data; zeros of the margin are meaningful only beside a depth
      t.pd = pd as Six<number> | null;
      t.gm = gm === null || (gm as Six<number>).every((v) => v === null) ? null : gm as Six<number>;
      t.bop = bop as Six<boolean> | null; t.plaque = plaque as Six<boolean> | null; t.suppuration = supp as Six<boolean> | null;
      t.mobility = mob;
      const allowed = new Set(furcationsOf(tooth));
      for (const f of ["b", "l", "m", "d"] as Furcation[]) {
        const v = intIn(r[`furcation_${f}`], 0, 3);
        if (Number.isNaN(v)) return { error: "range" };
        t[`furcation_${f}`] = allowed.has(f) ? v : null;
      }
    }
    const note = typeof r.note === "string" ? r.note.trim().slice(0, 500) : "";
    t.note = note || null;
    teeth.push(t);
  }
  return { teeth };
}

/** is there anything on this tooth worth saving? */
export const toothHasData = (t: PerioTooth) =>
  t.missing || t.implant || t.mobility !== null || !!t.pd || !!t.gm || !!t.bop || !!t.plaque || !!t.suppuration || !!t.note
  || [t.furcation_b, t.furcation_l, t.furcation_m, t.furcation_d].some((f) => f !== null);

/** turns a typed site value into a number (or null); "-" alone and "" are empty */
export function readSite(v: string, lo: number, hi: number): number | null | "bad" {
  const s = v.trim();
  if (s === "" || s === "-" || s === "+") return null;
  if (!/^[-+]?\d{1,2}$/.test(s)) return "bad";
  const n = Number(s);
  return n >= lo && n <= hi ? n : "bad";
}
/**
 * Quick entry: after a keystroke, should the cursor move to the next site? A single digit moves on, except "1" when 10–20 may
 * follow (probing depths) and a lone sign; two digits always move on.
 */
export function siteComplete(v: string, waitAfterOne = true): boolean {
  const s = v.replace(/^[-+]/, "");
  if (!/^\d+$/.test(s)) return false;
  if (s.length >= 2) return true;
  return !waitAfterOne || s !== "1";
}
