import { describe, expect, it } from "vitest";
import { buildChart, niceTicks } from "@/lib/clinical/chart";
import { bucket, buildSeries, deltas, DAY, previousWindow, resolveWindow, shiftForward, stats } from "@/lib/clinical/series";
import { ageLabel, ageParts } from "@/lib/format";
import type { ObservationRow, ObservationType } from "@/lib/types";

const bpType = { code: "blood_pressure", value_kind: "bp", name_ar: "ضغط", name_en: "BP", default_unit: "mmHg" } as ObservationType;
const glu = { code: "blood_glucose", value_kind: "numeric", name_ar: "سكر", name_en: "Glucose", default_unit: "mg/dL" } as ObservationType;
const NOW = Date.parse("2026-06-30T12:00:00Z");

function obs(over: Partial<ObservationRow>): ObservationRow {
  return { id: Math.random().toString(36).slice(2), patient_id: "p", type_id: "t", value_num: 100, value_num2: null, unit: "mg/dL", effective_at: new Date(NOW).toISOString(),
    status: "final", interpretation: "normal", context: null, ref_low: null, ref_high: null, ...over } as ObservationRow;
}

describe("series", () => {
  it("keeps systolic and diastolic together as a pair of series", () => {
    const s = buildSeries(bpType, [obs({ value_num: 130, value_num2: 85, unit: "mmHg" }), obs({ value_num: 120, value_num2: 80, unit: "mmHg", effective_at: new Date(NOW - DAY).toISOString() })]);
    expect(s.map((x) => x.role)).toEqual(["sys", "dia"]);
    expect(s[0].pts.map((p) => p.v)).toEqual([120, 130]);
    expect(s[1].pts.map((p) => p.v)).toEqual([80, 85]);
  });

  it("never mixes units on one line", () => {
    const s = buildSeries(glu, [obs({ value_num: 100, unit: "mg/dL" }), obs({ value_num: 5.5, unit: "mmol/L" })]);
    expect(s).toHaveLength(2);
    expect(new Set(s.map((x) => x.unit))).toEqual(new Set(["mg/dL", "mmol/L"]));
  });

  it("excludes amended and entered-in-error results from plots", () => {
    const s = buildSeries(glu, [obs({ value_num: 100 }), obs({ value_num: 200, status: "amended" }), obs({ value_num: 300, status: "entered_in_error" })]);
    expect(s[0].pts).toHaveLength(1);
    expect(s[0].pts[0].v).toBe(100);
  });

  it("skips text-only results", () => {
    expect(buildSeries(glu, [obs({ value_num: null, value_text: "Trace" })])).toEqual([]);
  });

  it("computes stats and ignores noise below 3% as flat", () => {
    const pts = buildSeries(glu, [obs({ value_num: 100, effective_at: new Date(NOW - 2 * DAY).toISOString() }), obs({ value_num: 102 })])[0].pts;
    const st = stats(pts)!;
    expect(st.count).toBe(2);
    expect(st.trend).toBe("flat");
    expect(st.delta).toBe(2);
    const up = stats(buildSeries(glu, [obs({ value_num: 100, effective_at: new Date(NOW - 2 * DAY).toISOString() }), obs({ value_num: 140 })])[0].pts)!;
    expect(up.trend).toBe("up");
    expect(stats([])).toBeNull();
  });

  it("gives no delta across a unit change", () => {
    const a = obs({ value_num: 100, unit: "mg/dL", effective_at: new Date(NOW - 3 * DAY).toISOString() });
    const b = obs({ value_num: 110, unit: "mg/dL", effective_at: new Date(NOW - 2 * DAY).toISOString() });
    const c = obs({ value_num: 6, unit: "mmol/L", effective_at: new Date(NOW - DAY).toISOString() });
    const d = deltas([a, b, c]);
    expect(d.get(a.id)).toBeNull();
    expect(d.get(b.id)).toBe(10);
    expect(d.get(c.id)).toBeNull();
  });

  it("resolves windows and the equal-length previous window", () => {
    const w = resolveWindow("30", undefined, undefined, NOW)!;
    expect(w.to - w.from).toBe(30 * DAY);
    const prev = previousWindow(w)!;
    expect(prev.to).toBeLessThan(w.from);
    expect(Math.abs(prev.to - prev.from - 30 * DAY)).toBeLessThanOrEqual(1);
    expect(previousWindow(resolveWindow("all", undefined, undefined, NOW)!)).toBeNull();
    expect(resolveWindow(undefined, "2026-02-01", "2026-01-01")).toBeNull();
    expect(resolveWindow(undefined, "2026-01-01", "2026-01-31")!.to - Date.parse("2026-01-31")).toBe(DAY - 1);
    expect(shiftForward([{ t: 5 } as never], 10)[0].t).toBe(15);
  });

  it("buckets by day, week (Monday) and month", () => {
    const mk = (iso: string, v: number) => ({ t: Date.parse(iso), v }) as never;
    const pts = [mk("2026-06-01T08:00:00Z", 100), mk("2026-06-01T20:00:00Z", 120), mk("2026-06-03T08:00:00Z", 90), mk("2026-06-09T08:00:00Z", 80)];
    const day = bucket(pts, "day");
    expect(day).toHaveLength(3);
    expect(day[0]).toMatchObject({ n: 2, mean: 110, min: 100, max: 120 });
    expect(bucket(pts, "week")).toHaveLength(2); // Mon 1 Jun + Tue 9 Jun are in different weeks
    expect(bucket(pts, "month")).toHaveLength(1);
  });
});

describe("chart", () => {
  it("produces nice ticks", () => {
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
    const t = niceTicks(72, 138);
    expect(t[0]).toBeLessThanOrEqual(72);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(138);
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
  });

  it("handles empty data and a single point", () => {
    expect(buildChart({ series: [], width: 600, height: 240 }).empty).toBe(true);
    const s = buildSeries(glu, [obs({ value_num: 100 })]);
    const c = buildChart({ series: s, width: 600, height: 240 });
    expect(c.empty).toBe(false);
    expect(c.points).toHaveLength(1);
    expect(Number.isFinite(c.points[0].x) && Number.isFinite(c.points[0].y)).toBe(true);
  });

  it("maps larger values higher on the chart and keeps points inside the frame", () => {
    const s = buildSeries(glu, [obs({ value_num: 80, effective_at: new Date(NOW - DAY).toISOString() }), obs({ value_num: 160 })]);
    const c = buildChart({ series: s, width: 600, height: 240, refLines: [{ v: 100, label: "100" }] });
    const [a, b] = c.points;
    expect(b.y).toBeLessThan(a.y); // SVG y grows downward
    expect(b.x).toBeGreaterThan(a.x);
    for (const p of c.points) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(600); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(240); }
    expect(c.refLines).toHaveLength(1);
  });
});

describe("age", () => {
  it("is computed from the date of birth", () => {
    const now = new Date("2026-06-30T00:00:00Z");
    expect(ageParts("1990-06-30", now).years).toBe(36);
    expect(ageParts("1990-07-01", now).years).toBe(35);
    expect(ageLabel("2026-01-15", "en", now)).toBe("5 mo");
    expect(ageLabel("1990-01-01", "ar", now)).toBe("36 سنة");
  });
});

import { parseLocaleNumber } from "@/lib/clinical/number";
describe("parseLocaleNumber", () => {
  it("accepts Western and Arabic-Indic digits and decimal marks", () => {
    expect(parseLocaleNumber("12.5")).toBe(12.5);
    expect(parseLocaleNumber("١٢٫٥")).toBe(12.5);
    expect(parseLocaleNumber("12,5")).toBe(12.5);
    expect(parseLocaleNumber(" 1,234.5 ")).toBe(1234.5);
    expect(parseLocaleNumber("-3")).toBe(-3);
  });
  it("rejects non-numbers instead of guessing", () => {
    for (const bad of ["", "abc", "12abc", "1.2.3", "NaN", "Infinity", "1e5", null, undefined]) expect(parseLocaleNumber(bad as never)).toBeNull();
  });
});

import { pdfHasActiveContent, safeFilename, sniffMime } from "@/lib/files";
const bytes = (...n: number[]) => new Uint8Array([...n, ...new Array(16).fill(0)]);
describe("file sniffing", () => {
  it("identifies allowed types by content", () => {
    expect(sniffMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("application/pdf");
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]))).toBe("image/webp");
  });
  it("rejects executables, scripts, svg and truncated files regardless of name", () => {
    expect(sniffMime(bytes(0x4d, 0x5a, 0x90))).toBeNull();                        // Windows executable
    expect(sniffMime(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffMime(new Uint8Array([0x25, 0x50]))).toBeNull();
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });
  it("flags PDFs with active content", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(pdfHasActiveContent(enc("%PDF-1.7 1 0 obj << /S /JavaScript /JS (app.alert(1)) >>"))).toBe(true);
    expect(pdfHasActiveContent(enc("%PDF-1.4 << /Type /Catalog /OpenAction << /S /Launch >> >>"))).toBe(true);
    expect(pdfHasActiveContent(enc("%PDF-1.4 << /Type /Page /Contents 4 0 R >> (a plain report)"))).toBe(false);
  });
  it("sanitises file names", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("تقرير 1.pdf")).toBe("تقرير 1.pdf");
    expect(safeFilename('a<b>"c.pdf')).toBe("a_b__c.pdf");
  });
});
