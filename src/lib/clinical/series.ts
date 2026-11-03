import type { ObservationRow, ObservationType } from "@/lib/types";

export const DAY = 86_400_000;

export interface Pt {
  t: number;
  v: number;
  id: string;
  interp: string;
  context: string | null;
  refLow: number | null;
  refHigh: number | null;
  lab: string | null;
  unit: string;
}
export interface Series {
  key: string;
  label: { ar: string; en: string };
  unit: string;
  role: "main" | "sys" | "dia";
  pts: Pt[];
}

/** Only approved/preliminary readings are plotted; amended and entered-in-error rows stay in the history table. */
export const plottable = (o: ObservationRow) => o.status === "final" || o.status === "preliminary";

/**
 * Builds chart series for one observation type. Readings in different units are NEVER mixed on one line:
 * each unit becomes its own series so a mg/dL value is never compared with a mmol/L value.
 */
export function buildSeries(type: ObservationType, rows: ObservationRow[], labOf?: (o: ObservationRow) => string | null): Series[] {
  const byUnit = new Map<string, ObservationRow[]>();
  for (const r of rows) {
    if (!plottable(r) || r.value_num == null) continue;
    const u = r.unit ?? type.default_unit ?? "";
    byUnit.set(u, [...(byUnit.get(u) ?? []), r]);
  }
  const out: Series[] = [];
  for (const [unit, list] of Array.from(byUnit.entries())) {
    const pt = (r: ObservationRow, v: number): Pt => ({
      t: Date.parse(r.effective_at), v, id: r.id, interp: r.interpretation, context: r.context,
      refLow: r.ref_low, refHigh: r.ref_high, lab: labOf ? labOf(r) : null, unit,
    });
    const sorted = [...list].sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at));
    if (type.value_kind === "bp") {
      out.push({ key: `${type.code}:${unit}:sys`, label: { ar: "الانقباضي", en: "Systolic" }, unit, role: "sys", pts: sorted.map((r) => pt(r, r.value_num as number)) });
      out.push({ key: `${type.code}:${unit}:dia`, label: { ar: "الانبساطي", en: "Diastolic" }, unit, role: "dia",
        pts: sorted.filter((r) => r.value_num2 != null).map((r) => pt(r, r.value_num2 as number)) });
    } else {
      out.push({ key: `${type.code}:${unit}`, label: { ar: type.name_ar, en: type.name_en }, unit, role: "main", pts: sorted.map((r) => pt(r, r.value_num as number)) });
    }
  }
  return out;
}

export interface Stats { count: number; min: number; max: number; mean: number; latest: Pt; first: Pt; delta: number; trend: "up" | "down" | "flat" }

export function stats(pts: Pt[]): Stats | null {
  if (!pts.length) return null;
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const vs = sorted.map((p) => p.v);
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const delta = latest.v - first.v;
  // a change under 3% of the mean is reported as "flat" so noise is not presented as a trend
  const trend = sorted.length < 2 || Math.abs(delta) < Math.abs(mean) * 0.03 ? "flat" : delta > 0 ? "up" : "down";
  return { count: sorted.length, min: Math.min(...vs), max: Math.max(...vs), mean, latest, first, delta, trend };
}

export interface Window { from: number; to: number }

export function resolveWindow(range: string | undefined, from: string | undefined, to: string | undefined, now = Date.now()): Window | null {
  if (from || to) {
    const f = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const t = to ? Date.parse(to) + DAY - 1 : now;
    if (Number.isNaN(f) || Number.isNaN(t) || f > t) return null;
    return { from: f, to: t };
  }
  const days = range === "7" ? 7 : range === "30" ? 30 : range === "90" ? 90 : range === "365" ? 365 : range === "all" ? 0 : 90;
  return days === 0 ? { from: Number.NEGATIVE_INFINITY, to: now } : { from: now - days * DAY, to: now };
}

export function inWindow(pts: Pt[], w: Window): Pt[] {
  return pts.filter((p) => p.t >= w.from && p.t <= w.to);
}

/** The window of equal length immediately before w (undefined for an unbounded window). */
export function previousWindow(w: Window): Window | null {
  if (!Number.isFinite(w.from)) return null;
  const len = w.to - w.from;
  return { from: w.from - len - 1, to: w.from - 1 };
}

/** Shifts the earlier period forward so it overlays the current one on the same time axis. */
export function shiftForward(pts: Pt[], by: number): Pt[] {
  return pts.map((p) => ({ ...p, t: p.t + by }));
}

/** Calendar-day buckets (UTC) with averages, used for daily/weekly/monthly aggregation views. */
export function bucket(pts: Pt[], unit: "day" | "week" | "month"): { start: number; mean: number; min: number; max: number; n: number }[] {
  const keyOf = (t: number) => {
    const d = new Date(t);
    if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (unit === "day") return day;
    const dow = (new Date(day).getUTCDay() + 6) % 7; // Monday start
    return day - dow * DAY;
  };
  const m = new Map<number, number[]>();
  for (const p of pts) m.set(keyOf(p.t), [...(m.get(keyOf(p.t)) ?? []), p.v]);
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([start, vs]) => ({
    start, n: vs.length, min: Math.min(...vs), max: Math.max(...vs), mean: vs.reduce((a, b) => a + b, 0) / vs.length,
  }));
}

/**
 * Readings that can be compared directly: same type, same unit. Returns the change between consecutive
 * results per unit; a unit switch yields no delta (null) instead of a misleading number.
 */
export function deltas(rows: ObservationRow[]): Map<string, number | null> {
  const sorted = rows.filter((r) => plottable(r) && r.value_num != null).sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at));
  const out = new Map<string, number | null>();
  let prev: ObservationRow | null = null;
  for (const r of sorted) {
    out.set(r.id, prev && prev.unit === r.unit ? (r.value_num as number) - (prev.value_num as number) : null);
    prev = r;
  }
  return out;
}
