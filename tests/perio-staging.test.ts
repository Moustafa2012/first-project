import { describe, expect, it } from "vitest";
import { emptyTooth, type PerioTooth } from "@/lib/perio";
import {
  ageOn, dxIsSet, dxLine, factorsFrom, maxInterdentalCal, parseDx, suggestDiagnosis, suggestExtent, suggestGrade, suggestStage, toothInterdentalCal,
  type PerioFactors,
} from "@/lib/perio-staging";
import { buildPerioPlan, needsRootPlaning } from "@/lib/perio-plan";

const NONE: PerioFactors = { ageYears: 40, tobacco: "never", cigarettesPerDay: null, diabetes: false, hba1c: null };

/** a tooth whose first interdental site (distobuccal) has exactly `cal` mm of attachment loss, every other site 0 mm; PD 3 everywhere */
const withCal = (n: number, cal: number, extra: Partial<PerioTooth> = {}): PerioTooth => ({
  ...emptyTooth(n), pd: [3, 3, 3, 3, 3, 3], gm: [3 - cal, 3, 3, 3, 3, 3], ...extra,
});
/** a tooth with no attachment loss at all (margins measured at 3 mm above the depth... CAL 0) */
const healthy = (n: number, extra: Partial<PerioTooth> = {}) => withCal(n, 0, extra);
const missing = (n: number): PerioTooth => ({ ...emptyTooth(n), missing: true });

describe("interdental attachment loss", () => {
  it("is counted at the four interdental sites only, and only where the margin was measured", () => {
    expect(toothInterdentalCal(withCal(16, 4))).toBe(4);
    // a buccal mid-site (index 1) with 7 mm of recession-driven loss is not interdental
    const buccal: PerioTooth = { ...emptyTooth(16), pd: [3, 3, 3, 3, 3, 3], gm: [3, -4, 3, 3, 3, 3] };
    expect(toothInterdentalCal(buccal)).toBe(0);
    // no margins → the attachment level is unknown, not equal to the depth
    expect(toothInterdentalCal({ ...emptyTooth(16), pd: [6, 6, 6, 6, 6, 6] })).toBeNull();
    expect(toothInterdentalCal(missing(16))).toBeNull();
    expect(maxInterdentalCal([withCal(11, 2), withCal(12, 5), missing(13)])).toBe(5);
    expect(maxInterdentalCal([])).toBeNull();
  });
});

describe("stage (2017)", () => {
  const stageOf = (teeth: PerioTooth[], rblPct: number | null = null, lost: number | null = null) => suggestStage({ teeth, rblPct, teethLostPerio: lost }).stage;
  it("follows the worst interdental CAL: 1–2 → I, 3–4 → II, 5 or more → III", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((c) => stageOf([withCal(16, c)]))).toEqual([null, "I", "I", "II", "II", "III", "III"]);
  });
  it("follows the radiographic bone loss: under 15 % → I, 15–33 % → II, over 33 % → III", () => {
    expect([0, 1, 14, 15, 33, 34, 60].map((r) => stageOf([healthy(16)], r))).toEqual([null, "I", "I", "II", "II", "III", "III"]);
  });
  it("takes the worst criterion: pockets of 5 mm → at least II, 6 mm → at least III", () => {
    const deep = (pd: number): PerioTooth => ({ ...emptyTooth(16), pd: [pd, 3, 3, 3, 3, 3], gm: [pd - 1, 3, 3, 3, 3, 3] }); // CAL 1 → I by attachment
    expect([4, 5, 6, 8].map((p) => stageOf([deep(p)]))).toEqual(["I", "II", "III", "III"]);
  });
  it("furcation of grade II or III → III; grade I changes nothing", () => {
    expect(stageOf([withCal(16, 1, { furcation_b: 1 })])).toBe("I");
    expect(stageOf([withCal(16, 1, { furcation_b: 2 })])).toBe("III");
    expect(stageOf([withCal(16, 1, { furcation_m: 3 })])).toBe("III");
    // on a missing tooth a stale furcation is ignored
    expect(stageOf([withCal(11, 1), { ...missing(16), furcation_b: 3 }])).toBe("I");
  });
  it("teeth lost to periodontitis: 1–4 → III, 5 or more → IV", () => {
    expect([null, 0, 1, 4, 5, 9].map((n) => stageOf([withCal(16, 1)], null, n))).toEqual(["I", "I", "III", "III", "IV", "IV"]);
  });
  it("complexity: stage III with fewer than 20 teeth left becomes IV", () => {
    const base = [withCal(16, 5)];
    const gone = (n: number) => Array.from({ length: n }, (_, i) => missing([11, 12, 13, 14, 15, 17, 18, 21, 22, 23, 24, 25, 26][i]));
    expect(stageOf([...base, ...gone(12)])).toBe("III");
    expect(stageOf([...base, ...gone(13)])).toBe("IV");
    // the loss of teeth does not stage a healthy mouth
    expect(stageOf([healthy(16), ...gone(13)])).toBeNull();
  });
  it("explains itself", () => {
    const r = suggestStage({ teeth: [withCal(16, 4)], rblPct: 20, teethLostPerio: 0 });
    expect(r.stage).toBe("II");
    expect(r.reasons.map((x) => x.en)).toEqual(expect.arrayContaining(["Worst interdental attachment loss 4 mm", "Radiographic bone loss 20%"]));
    expect(suggestStage({ teeth: [], rblPct: null, teethLostPerio: null })).toEqual({ stage: null, reasons: [{ ar: "لا يوجد فقد ارتباط أو عظم يُحسب.", en: "No attachment or bone loss to stage." }] });
  });
});

describe("grade (2017)", () => {
  const gradeOf = (rbl: number | null, f: Partial<PerioFactors> = {}) => suggestGrade({ rblPct: rbl, factors: { ...NONE, ...f } }).grade;
  it("uses bone loss ÷ age: under 0.25 → A, 0.25–1.0 → B, over 1.0 → C (age 40)", () => {
    expect([0, 9, 10, 20, 40, 41, 80].map((r) => gradeOf(r))).toEqual(["A", "A", "B", "B", "B", "C", "C"]);
  });
  it("starts at B when there is no bone loss figure or no age", () => {
    expect(gradeOf(null)).toBe("B");
    expect(gradeOf(30, { ageYears: null })).toBe("B");
    expect(gradeOf(30, { ageYears: 0 })).toBe("B");
  });
  it("smoking raises the grade: any current smoker → at least B, 10 a day or more → C; ex-smokers do not count", () => {
    expect(gradeOf(5, { tobacco: "current", cigarettesPerDay: 9 })).toBe("B");
    expect(gradeOf(5, { tobacco: "current", cigarettesPerDay: null })).toBe("B");
    expect(gradeOf(5, { tobacco: "current", cigarettesPerDay: 10 })).toBe("C");
    expect(gradeOf(5, { tobacco: "former", cigarettesPerDay: 30 })).toBe("A");
    expect(gradeOf(5, { tobacco: "unknown" })).toBe("A");
  });
  it("diabetes raises the grade: HbA1c 7 % or more → C, otherwise or unknown → at least B", () => {
    expect(gradeOf(5, { diabetes: true, hba1c: 6.9 })).toBe("B");
    expect(gradeOf(5, { diabetes: true, hba1c: 7 })).toBe("C");
    expect(gradeOf(5, { diabetes: true, hba1c: null })).toBe("B");
    expect(gradeOf(5, { diabetes: false, hba1c: 9 })).toBe("A");
  });
  it("modifiers only raise: a high ratio is not lowered, and the highest modifier wins", () => {
    expect(gradeOf(60, { tobacco: "current", cigarettesPerDay: 1 })).toBe("C");
    expect(gradeOf(20, { tobacco: "current", cigarettesPerDay: 2, diabetes: true, hba1c: 8 })).toBe("C");
  });
  it("gives its reasons", () => {
    const r = suggestGrade({ rblPct: 30, factors: { ...NONE, tobacco: "current", cigarettesPerDay: 20 } });
    expect(r.grade).toBe("C");
    expect(r.reasons.map((x) => x.en).join("|")).toMatch(/30% ÷ 40 = 0\.75/);
    expect(r.reasons.map((x) => x.en).join("|")).toMatch(/20 or more cigarettes/);
  });
});

describe("extent (2017)", () => {
  const upper = [11, 12, 13, 14, 15, 21, 22, 23, 24, 25];
  const chart = (involved: number[]) => upper.map((n) => (involved.includes(n) ? withCal(n, 2) : healthy(n)));
  it("is localized under 30 % of the teeth and generalized from 30 %", () => {
    expect(suggestExtent(chart([13, 14])).extent).toBe("localized");           // 20 %
    expect(suggestExtent(chart([13, 14, 15])).extent).toBe("generalized");     // 30 %
    expect(suggestExtent(chart(upper)).extent).toBe("generalized");
    const r = suggestExtent(chart([13, 14]));
    expect([r.involved, r.charted, r.pct]).toEqual([2, 10, 20]);
  });
  it("recognises the molar–incisor pattern: only first molars and incisors, both kinds", () => {
    const teeth = [...chart([11, 21]), withCal(16, 3), healthy(26), healthy(36), healthy(46), healthy(31), healthy(41)];
    expect(suggestExtent(teeth).extent).toBe("molar_incisor");
    // a premolar involved, or only incisors, is not the pattern
    expect(suggestExtent([...chart([11, 14]), withCal(16, 3), healthy(26)]).extent).not.toBe("molar_incisor");
    expect(suggestExtent([...chart([11, 21]), healthy(16)]).extent).toBe("localized");
  });
  it("leaves missing teeth, implants and unprobed teeth out of the count, and says nothing when no tooth is involved", () => {
    const r = suggestExtent([withCal(13, 2), healthy(14), missing(15), { ...healthy(12), implant: true }, emptyTooth(11)]);
    expect([r.involved, r.charted]).toEqual([1, 2]);
    expect(suggestExtent([healthy(16), healthy(11)]).extent).toBeNull();
    expect(suggestExtent([]).extent).toBeNull();
  });
});

describe("the whole suggestion", () => {
  const o = { rblPct: null, teethLostPerio: null, factors: NONE };
  it("suggests nothing without measurements", () => {
    const r = suggestDiagnosis([], o);
    expect([r.kind, r.stage, r.grade, r.extent]).toEqual([null, null, null, null]);
  });
  it("health or gingivitis when there is no attachment loss, by bleeding on probing (10 %)", () => {
    const bleeding = (n: number) => healthy(n, { bop: [true, true, true, true, true, true] });
    expect(suggestDiagnosis([healthy(16), healthy(11)], o).kind).toBe("health");
    expect(suggestDiagnosis([bleeding(16), healthy(11), healthy(12)], o).kind).toBe("gingivitis");
    expect(suggestDiagnosis([bleeding(16)], o).stage).toBeNull();
  });
  it("periodontitis with stage, grade and extent when attachment is lost", () => {
    const teeth = [withCal(16, 5), withCal(26, 4), healthy(11), healthy(21)];
    const r = suggestDiagnosis(teeth, { rblPct: 45, teethLostPerio: 1, factors: { ...NONE, tobacco: "current", cigarettesPerDay: 15 } });
    expect([r.kind, r.stage, r.grade, r.extent]).toEqual(["periodontitis", "III", "C", "generalized"]);
    expect(r.stageReasons.length).toBeGreaterThan(1);
    expect(r.gradeReasons.length).toBeGreaterThan(1);
  });
});

describe("age and factors", () => {
  it("counts whole years at the exam date", () => {
    expect([ageOn("1980-05-05", "2025-05-04"), ageOn("1980-05-05", "2025-05-05"), ageOn("1980-05-05", "2025-12-31")]).toEqual([44, 45, 45]);
    expect([ageOn(null, "2025-01-01"), ageOn("2030-01-01", "2025-01-01"), ageOn("garbage", "2025-01-01")]).toEqual([null, null, null]);
  });
  it("builds the grade factors from the file", () => {
    expect(factorsFrom({ dob: "1980-05-05", on: "2025-05-05", tobaccoStatus: "current", cigarettesPerDay: 12, diabetes: true, hba1c: 8.1 }))
      .toEqual({ ageYears: 45, tobacco: "current", cigarettesPerDay: 12, diabetes: true, hba1c: 8.1 });
    expect(factorsFrom({ dob: null, on: "2025-05-05" })).toEqual({ ageYears: null, tobacco: "unknown", cigarettesPerDay: null, diabetes: false, hba1c: null });
  });
});

describe("the diagnosis the form sends", () => {
  const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";
  it("keeps stage, grade and extent for periodontitis only", () => {
    const r = parseDx(form({ dx_kind: "periodontitis", dx_stage: "III", dx_grade: "B", dx_extent: "generalized", dx_rbl_pct: "40", dx_teeth_lost_perio: "1", dx_note: " note " }), true);
    expect(r).toEqual({ dx: { dx_kind: "periodontitis", dx_stage: "III", dx_grade: "B", dx_extent: "generalized", dx_rbl_pct: 40, dx_teeth_lost_perio: 1, dx_note: "note" } });
    const g = parseDx(form({ dx_kind: "gingivitis", dx_stage: "II", dx_grade: "A" }), true);
    expect(g).toEqual({ dx: { dx_kind: "gingivitis", dx_stage: null, dx_grade: null, dx_extent: null, dx_rbl_pct: null, dx_teeth_lost_perio: null, dx_note: null } });
  });
  it("lets a draft be incomplete but not a final chart", () => {
    expect(parseDx(form({ dx_kind: "periodontitis", dx_stage: "III" }), false)).toMatchObject({ dx: { dx_stage: "III", dx_grade: null } });
    expect(parseDx(form({ dx_kind: "periodontitis", dx_stage: "III" }), true)).toEqual({ error: "dx_incomplete" });
  });
  it("refuses unknown values and numbers out of range", () => {
    for (const bad of [{ dx_kind: "severe" }, { dx_kind: "periodontitis", dx_stage: "V" }, { dx_kind: "periodontitis", dx_grade: "D" }, { dx_kind: "periodontitis", dx_extent: "everywhere" },
                       { dx_rbl_pct: "101" }, { dx_rbl_pct: "-1" }, { dx_rbl_pct: "abc" }, { dx_teeth_lost_perio: "33" }] as Record<string, string>[]) {
      expect(parseDx(form(bad), false)).toEqual({ error: "dx_invalid" });
    }
    expect(parseDx(form({ dx_rbl_pct: "100", dx_teeth_lost_perio: "32" }), false)).toMatchObject({ dx: { dx_rbl_pct: 100, dx_teeth_lost_perio: 32 } });
    expect(parseDx(form({}), true)).toEqual({ dx: expect.objectContaining({ dx_kind: null }) });
  });
  it("writes the diagnosis in one line", () => {
    expect(dxLine({ dx_kind: "periodontitis", dx_stage: "III", dx_grade: "B", dx_extent: "generalized" }, "en")).toBe("Periodontitis — Stage III, Grade B, Generalized (≥ 30% of teeth)".replace(/ \(.*\)$/, ""));
    expect(dxLine({ dx_kind: "health" }, "en")).toBe("Periodontal health");
    expect(dxLine({}, "en")).toBe("");
    expect(dxIsSet({ dx_kind: null, dx_note: null })).toBe(false);
    expect(dxIsSet({ dx_rbl_pct: 0 })).toBe(true);
  });
});

describe("the phased periodontal plan", () => {
  const pocket = (n: number, pd = 5, extra: Partial<PerioTooth> = {}): PerioTooth => ({ ...emptyTooth(n), pd: [pd, 3, 3, 3, 3, 3], gm: [0, 0, 0, 0, 0, 0], ...extra });
  const input = { examDate: "2025-03-01", dx: { dx_kind: "periodontitis", dx_stage: "III", dx_grade: "B", dx_extent: "generalized" }, lang: "en" as const };
  it("has the four phases with catalogue codes, root planing per quadrant", () => {
    const plan = buildPerioPlan({ ...input, teeth: [pocket(16), pocket(17, 6), pocket(26), pocket(46), healthy(36)] });
    expect(plan.items.map((i) => [i.phase, i.catalog_code])).toEqual([
      [1, "hygiene_instruction"], [1, "root_planing"], [1, "root_planing"], [1, "root_planing"], [2, "perio_reevaluation"], [3, "perio_flap_surgery"], [4, "perio_maintenance"],
    ]);
    const rp = plan.items.filter((i) => i.catalog_code === "root_planing");
    expect(rp.map((i) => i.teeth)).toEqual([[16, 17], [26], [46]]);
    expect(rp[0].name).toMatch(/upper right quadrant/);
    expect(plan.items.find((i) => i.phase === 3)?.teeth).toEqual([16, 17, 26, 46]);
    expect(plan.title).toBe("Periodontal treatment plan — 2025-03-01");
    expect(plan.notes).toMatch(/Periodontitis — Stage III, Grade B, Generalized/);
  });
  it("falls back to scaling when no tooth needs root planing, and keeps the optional surgery item", () => {
    const plan = buildPerioPlan({ ...input, teeth: [healthy(16), healthy(11)] });
    expect(plan.items.map((i) => i.catalog_code)).toEqual(["hygiene_instruction", "scaling", "perio_reevaluation", "perio_flap_surgery", "perio_maintenance"]);
    expect(plan.items.find((i) => i.phase === 3)).not.toHaveProperty("teeth");
  });
  it("needs root planing at 4 mm of depth or 3 mm of attachment loss, never on a missing tooth or an implant", () => {
    expect(needsRootPlaning(pocket(16, 4))).toBe(true);
    expect(needsRootPlaning(healthy(16))).toBe(false);
    expect(needsRootPlaning(withCal(16, 3))).toBe(true);
    expect(needsRootPlaning({ ...pocket(16, 7), implant: true })).toBe(false);
    expect(needsRootPlaning(missing(16))).toBe(false);
  });
  it("speaks Arabic when asked", () => {
    const plan = buildPerioPlan({ ...input, lang: "ar", teeth: [pocket(16)] });
    expect(plan.title).toContain("خطة علاج اللثة");
    expect(plan.items[1].name).toContain("الربع العلوي الأيمن");
  });
});
