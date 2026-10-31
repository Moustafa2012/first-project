import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAM_SECTIONS, PULP_RESULTS_FOR, parsePulpTests, parseSections, summarizeSections } from "@/lib/dental-exam";
import { parseExamForm } from "@/lib/dental";

describe("exam sections", () => {
  it("match the keys and values the database accepts (migration 0024)", () => {
    const sql = readFileSync(join(__dirname, "../supabase/migrations/0024_baseline_exam.sql"), "utf8");
    const dbSpec = JSON.parse(/select '(\{.*\})'::jsonb/.exec(sql)![1]);
    const mine: Record<string, Record<string, unknown[]>> = {};
    for (const s of EXAM_SECTIONS) {
      mine[s.key] = {};
      for (const [k, f] of s.fields) mine[s.key][k] = f.kind === "enum" ? ["enum", f.options.map(([o]) => o)] : f.kind === "int" ? ["int", f.min, f.max] : ["text", f.max];
    }
    expect(dbSpec).toEqual(mine);
  });
  it("keep known values, drop empty ones, refuse unknown values and out-of-range measures", () => {
    expect(parseSections({ extraoral: { face: "normal", mouth_opening_mm: "42", tmj_pain: "" }, hygiene: {} }))
      .toEqual({ sections: { extraoral: { face: "normal", mouth_opening_mm: 42 } } });
    expect(parseSections({ extraoral: { face: "weird" } })).toEqual({ error: true });
    expect(parseSections({ extraoral: { mouth_opening_mm: 200 } })).toEqual({ error: true });
    expect(parseSections({ occlusion: { overjet_mm: "2.5" } })).toEqual({ error: true });
    expect(parseSections({ astrology: { x: 1 } })).toEqual({ sections: {} });
  });
  it("summarise what is not normal, and flag a suspicious soft-tissue lesion", () => {
    const lines = summarizeSections({
      extraoral: { face: "normal", lymph_nodes: "normal", tmj_sounds: "click", mouth_opening_mm: 38 },
      soft_tissue: { lips: "normal", tongue: "abnormal", cancer_screening: "suspicious", note: "white patch" },
    }, "en");
    expect(lines[0]).toMatchObject({ key: "extraoral", flag: false });
    expect(lines[0].text).toBe("2 items normal · TMJ sounds: Click · Maximum mouth opening 38 mm");
    expect(lines[1].flag).toBe(true);
    expect(lines[1].text).toContain("Oral cancer screening: Suspicious lesion");
    expect(summarizeSections({ soft_tissue: { lips: "normal", cancer_screening: "no_suspicious" } }, "ar")[0].text).toBe("طبيعي");
  });
});

describe("pulp tests", () => {
  it("only accept results that suit the test", () => {
    expect(parsePulpTests([{ tooth: 36, test: "cold", result: "lingering" }, { tooth: 11, test: "ept", result: "normal", value: " 38/80 " }]))
      .toEqual({ tests: [{ tooth: 36, test: "cold", result: "lingering" }, { tooth: 11, test: "ept", result: "normal", value: "38/80" }] });
    expect(parsePulpTests([{ tooth: 36, test: "percussion", result: "lingering" }])).toEqual({ error: true });
    expect(parsePulpTests([{ tooth: 99, test: "cold", result: "normal" }])).toEqual({ error: true });
    expect(PULP_RESULTS_FOR.bite).toEqual(["normal", "tender"]);
  });
});

describe("the exam form", () => {
  const t = (_a: string, e: string) => e;
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  it("accepts an exam of the soft tissues alone, marked as the baseline", () => {
    const r = parseExamForm(fd({ exam_date: "2026-01-10", sections: JSON.stringify({ soft_tissue: { tongue: "normal" } }), is_baseline: "on" }), t, "2026-10-31");
    expect("exam" in r && r.exam).toMatchObject({ is_baseline: true, sections: { soft_tissue: { tongue: "normal" } } });
  });
  it("refuses an empty exam", () => {
    const r = parseExamForm(fd({ exam_date: "2026-01-10" }), t, "2026-10-31");
    expect("error" in r && r.error).toMatch(/at least one/);
  });
  it("accepts the new findings", () => {
    const r = parseExamForm(fd({ exam_date: "2026-01-10", findings: JSON.stringify([{ tooth: 26, kind: "retained_root", evidence: "radiographic", surfaces: ["M"] }]) }), t, "2026-10-31");
    expect("findings" in r && r.findings[0]).toMatchObject({ kind: "retained_root", surfaces: [] });
  });
});
