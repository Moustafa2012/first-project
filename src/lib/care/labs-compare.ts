/**
 * Comparing two lab reports side by side: for each test in either report, its value in both with the change. A change is
 * computed only between values in the same unit; a unit switch shows both values and no difference (nothing is converted
 * behind the reader's back). Tests are matched by their type, and by their own name for "other" tests.
 */
import type { ObservationRow } from "@/lib/types";

export interface CompareSide { id: string; value: string; num: number | null; unit: string | null; interpretation: string; refLow: number | null; refHigh: number | null }
export interface CompareRow {
  key: string; typeId: string; customName: string | null; a: CompareSide | null; b: CompareSide | null;
  /** b minus a, when both are numbers in the same unit */
  delta: number | null;
  /** change as a share of a (not when a is zero) */
  pct: number | null;
  dir: "up" | "down" | "flat" | "none";
  /** the unit differs between the sides: both values are shown, no change */
  unitChanged: boolean;
}

const usable = (o: ObservationRow) => o.status === "final" || o.status === "preliminary";
const text = (o: ObservationRow) => (o.value_num != null ? (o.value_num2 != null ? `${o.value_num}/${o.value_num2}` : String(o.value_num)) : o.value_text ?? "");
const side = (o: ObservationRow): CompareSide => ({ id: o.id, value: text(o), num: o.value_num2 != null ? null : o.value_num, unit: o.unit, interpretation: o.interpretation, refLow: o.ref_low, refHigh: o.ref_high });

/** One result per test in a report: if a test appears twice, the latest by time wins. */
function byTest(rows: ObservationRow[]): Map<string, ObservationRow> {
  const out = new Map<string, ObservationRow>();
  for (const o of rows.filter(usable)) {
    const k = `${o.type_id}|${o.custom_name ?? ""}`;
    const cur = out.get(k);
    if (!cur || Date.parse(o.effective_at) > Date.parse(cur.effective_at)) out.set(k, o);
  }
  return out;
}

export function compareReports(a: ObservationRow[], b: ObservationRow[]): CompareRow[] {
  const ma = byTest(a), mb = byTest(b);
  const keys = Array.from(new Set([...Array.from(ma.keys()), ...Array.from(mb.keys())]));
  return keys.map((key): CompareRow => {
    const oa = ma.get(key), ob = mb.get(key), any = (oa ?? ob) as ObservationRow;
    const sa = oa ? side(oa) : null, sb = ob ? side(ob) : null;
    const comparable = sa && sb && sa.num != null && sb.num != null;
    const sameUnit = comparable && (sa.unit ?? "") === (sb.unit ?? "");
    const delta = sameUnit ? Number(((sb.num as number) - (sa.num as number)).toFixed(4)) : null;
    const pct = delta != null && (sa?.num as number) !== 0 ? Number(((delta / Math.abs(sa?.num as number)) * 100).toFixed(1)) : null;
    const flat = delta != null && Math.abs(delta) <= Math.abs(sa?.num as number) * 0.005;
    return {
      key, typeId: any.type_id, customName: any.custom_name, a: sa, b: sb, delta, pct,
      dir: delta == null ? "none" : flat ? "flat" : delta > 0 ? "up" : "down", unitChanged: Boolean(comparable && !sameUnit),
    };
  });
}

/** The date a report is known by: when the sample was taken, else when it was performed or approved. */
export function reportDate(r: { collected_at: string | null; performed_at: string | null; approved_at: string | null; recorded_at: string }): string {
  return (r.collected_at ?? r.performed_at ?? r.approved_at ?? r.recorded_at).slice(0, 10);
}
