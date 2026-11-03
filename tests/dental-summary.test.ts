import { describe, expect, it } from "vitest";
import { buildDentalSummary, type DentalSummaryInput } from "@/lib/dental-summary";
import { emptyTooth, type PerioExam, type PerioTooth } from "@/lib/perio";
import type { ExamRow, FindingRow } from "@/lib/dental";
import type { TreatmentItem, TreatmentPlan } from "@/lib/treatment";
import type { SafetyAlert } from "@/lib/safety-rules";

const TODAY = "2026-11-01";
const exam = (id: string, date: string, states: [number, string][], extra: Partial<ExamRow> = {}): ExamRow =>
  ({ id, exam_date: date, recorded_at: `${date}T09:00:00Z`, kind: "comprehensive", dentition: "permanent", states: states.map(([tooth, status]) => ({ tooth, status })), ...extra });
const finding = (id: string, tooth: number, kind: string, extra: Partial<FindingRow> = {}): FindingRow =>
  ({ id, exam_id: null, tooth, surfaces: [], kind, evidence: "clinical", observed_on: "2026-01-10", ...extra });
const base: DentalSummaryInput = { today: TODAY, exams: [], findings: [] };

describe("an empty file", () => {
  it("is empty and says nothing", () => {
    const s = buildDentalSummary(base);
    expect(s.empty).toBe(true);
    expect(s.chart).toEqual({ examined: 0, missing: [], restored: [], implants: [], open: [], openFindings: 0 });
    expect(s.baseline).toBeNull(); expect(s.perio).toBeNull(); expect(s.image).toBeNull(); expect(s.recall).toBeNull();
  });
});

describe("the current chart", () => {
  const exams = [
    exam("e1", "2025-03-01", [[18, "present"], [16, "present"], [26, "present"], [36, "present"], [46, "present"], [11, "present"]]),
    exam("e2", "2026-02-01", [[18, "extracted"], [36, "missing"], [46, "present"], [14, "present"]]),
  ];
  const findings = [
    finding("f1", 16, "caries"), finding("f2", 16, "abscess"), finding("f3", 26, "filling"), finding("f4", 14, "crown"),
    finding("f5", 11, "caries", { resolved_on: "2026-03-01" }), finding("f6", 46, "implant"), finding("f7", 36, "bridge_pontic"),
  ];
  const s = buildDentalSummary({ ...base, exams, findings });
  it("counts the teeth the latest exam found absent, and an implant on its own", () => {
    expect(s.chart.missing).toEqual([18, 36]);
    expect(s.chart.implants).toEqual([46]);
    expect(s.chart.examined).toBe(7);
  });
  it("lists restored teeth (not the absent ones, not an implant) and the teeth with open problems", () => {
    expect(s.chart.restored).toEqual([14, 26]);
    expect(s.chart.open).toEqual([16]);
    expect(s.chart.openFindings).toBe(2);
  });
  it("does not show a resolved finding", () => { expect(s.chart.open).not.toContain(11); });
  it("is not empty", () => { expect(s.empty).toBe(false); });
});

describe("baseline and the suspicious soft-tissue alert", () => {
  const soft = (v: string) => ({ soft_tissue: { cancer_screening: v, note: "white patch, left tongue" } });
  it("takes the earliest baseline exam and the open alert (reusing the exam rules)", () => {
    const exams = [
      exam("b", "2025-01-05", [[11, "present"]], { is_baseline: true, examiner_name: "Dr Ali" }),
      exam("a", "2026-05-01", [[11, "present"]], { sections: soft("suspicious") }),
    ];
    const s = buildDentalSummary({ ...base, exams });
    expect(s.baseline).toEqual({ id: "b", exam_date: "2025-01-05", examiner_name: "Dr Ali" });
    expect(s.softTissue).toMatchObject({ id: "a", exam_date: "2026-05-01", note: "white patch, left tongue" });
  });
  it("a later clinician's all-clear closes it, a patient report does not", () => {
    const e = (v: string, extra: Partial<ExamRow> = {}) => [exam("a", "2026-05-01", [], { sections: soft("suspicious") }), exam("c", "2026-07-01", [], { sections: soft(v), ...extra })];
    expect(buildDentalSummary({ ...base, exams: e("no_suspicious") }).softTissue).toBeNull();
    expect(buildDentalSummary({ ...base, exams: e("no_suspicious", { verification: "reported" }) }).softTissue?.id).toBe("a");
  });
});

describe("the periodontal chart", () => {
  const t = (n: number, pd: number[], gm: number[] | null = [0, 0, 0, 0, 0, 0], extra: Partial<PerioTooth> = {}): PerioTooth => ({ ...emptyTooth(n), pd, gm, ...extra });
  const chart = (id: string, date: string, teeth: PerioTooth[], extra: Partial<PerioExam> = {}): PerioExam =>
    ({ id, exam_date: date, status: "final", finalized_at: `${date}T10:00:00Z`, teeth, ...extra });
  const old = chart("p1", "2025-06-01", [t(16, [3, 3, 3, 3, 3, 3]), t(26, [3, 3, 3, 3, 3, 3])]);
  const mid = chart("p2", "2026-01-01", [t(16, [3, 3, 4, 3, 3, 3]), t(26, [3, 3, 3, 3, 3, 3])]);
  it("reports the newest final chart with its diagnosis and stage/grade", () => {
    const s = buildDentalSummary({ ...base, perio: [old, mid, chart("p3", "2026-09-01", [t(16, [3, 3, 3, 3, 3, 3])], { dx_kind: "periodontitis", dx_stage: "II", dx_grade: "B", dx_extent: "localized", dx_rbl_pct: 18 })] });
    expect(s.perio).toMatchObject({ id: "p3", exam_date: "2026-09-01", dx_kind: "periodontitis", dx_stage: "II", dx_grade: "B", dx_rbl_pct: 18 });
  });
  it("ignores drafts and charts entered in error", () => {
    const s = buildDentalSummary({ ...base, perio: [mid, chart("d", "2026-10-01", [], { status: "draft" }), chart("x", "2026-10-02", [], { record_status: "entered_in_error" })] });
    expect(s.perio?.id).toBe("p2");
    expect(s.perio?.change?.previous_id).toBeUndefined();
    expect(s.perio?.change).toBeNull();
  });
  it("compares with the previous final chart: worse, better, stable", () => {
    const worse = chart("w", "2026-09-01", [t(16, [3, 3, 7, 3, 3, 3]), t(26, [3, 3, 3, 3, 3, 3], [0, 0, 0, 0, 0, 0], { missing: true })]);
    const w = buildDentalSummary({ ...base, perio: [old, worse] }).perio!.change!;
    expect(w).toMatchObject({ previous_id: "p1", worse: 1, better: 0, lost: [26], direction: "worse" });
    const better = chart("b", "2026-09-01", [t(16, [3, 3, 3, 3, 3, 3])]);
    const deepBefore = chart("deep", "2026-01-01", [t(16, [3, 3, 7, 3, 3, 3])]);
    expect(buildDentalSummary({ ...base, perio: [deepBefore, better] }).perio!.change).toMatchObject({ better: 1, worse: 0, direction: "better", bop: [0, 0] });
    expect(buildDentalSummary({ ...base, perio: [old, chart("same", "2026-09-01", old.teeth)] }).perio!.change).toMatchObject({ direction: "stable", worse: 0, better: 0, lost: [] });
  });
  it("puts the bleeding percentage and mean depth of both charts in the change", () => {
    const bleeding = chart("bl", "2026-09-01", [t(16, [4, 4, 4, 4, 4, 4], [0, 0, 0, 0, 0, 0], { bop: [true, true, true, false, false, false] })]);
    const c = buildDentalSummary({ ...base, perio: [chart("o", "2026-01-01", [t(16, [3, 3, 3, 3, 3, 3])]), bleeding] }).perio!.change!;
    expect(c.bop).toEqual([0, 50]);
    expect(c.meanPd).toEqual([3, 4]);
  });
});

describe("pulp tests", () => {
  it("lists only the newest result of each test on each tooth, and only when it is not normal", () => {
    const exams = [exam("e1", "2025-01-01", []), exam("e2", "2026-01-01", [])];
    const s = buildDentalSummary({ ...base, exams, pulp: {
      e1: [{ tooth: 16, test: "cold", result: "no_response" }, { tooth: 21, test: "cold", result: "lingering" }, { tooth: 21, test: "percussion", result: "tender" }],
      e2: [{ tooth: 16, test: "cold", result: "normal" }, { tooth: 21, test: "percussion", result: "tender" }, { tooth: 46, test: "ept", result: "reduced" }],
    } });
    expect(s.pulp).toEqual([
      { tooth: 21, test: "cold", result: "lingering", exam_date: "2025-01-01" },
      { tooth: 21, test: "percussion", result: "tender", exam_date: "2026-01-01" },
      { tooth: 46, test: "ept", result: "reduced", exam_date: "2026-01-01" },
    ]);
  });
  it("ignores tests of exams that are not in the list (invalidated)", () => {
    expect(buildDentalSummary({ ...base, exams: [exam("e1", "2026-01-01", [])], pulp: { gone: [{ tooth: 11, test: "cold", result: "no_response" }] } }).pulp).toEqual([]);
  });
});

describe("the whole-mouth image", () => {
  const img = (id: string, modality: string, on: string | null, extra: Record<string, unknown> = {}) => ({ id, modality, teeth: null, performed_on: on, ...extra });
  it("is the newest panoramic, CBCT or cephalometric image with its bone reading", () => {
    const s = buildDentalSummary({ ...base, images: [
      img("old", "panoramic", "2024-01-01", { bone_levels: { s1: { level: "none" } } }),
      img("new", "panoramic", "2026-06-01", { impression: "generalised mild loss", bone_levels: { s1: { level: "coronal_third", pattern: "horizontal" }, s4: { level: "middle_third" } } }),
      { id: "pa", modality: "dental_xray", teeth: [16], performed_on: "2026-09-01" },
      img("bw", "dental_xray", "2026-10-01"),
    ] });
    expect(s.image).toMatchObject({ id: "new", impression: "generalised mild loss", worst: "middle_third" });
    expect(s.image?.bone?.s1?.level).toBe("coronal_third");
  });
  it("is null without one, and an undated one comes last", () => {
    expect(buildDentalSummary({ ...base, images: [{ id: "pa", modality: "panoramic", teeth: [16] }] }).image).toBeNull();
    expect(buildDentalSummary({ ...base, images: [img("u", "cbct", null), img("d", "panoramic", "2020-01-01")] }).image?.id).toBe("d");
  });
});

describe("treatment", () => {
  const item = (id: string, name: string, status: string, extra: Partial<TreatmentItem> = {}): TreatmentItem =>
    ({ id, catalog_code: null, name, teeth: [], surfaces: null, condition_id: null, phase: 1, status, surgical: false, scheduled_for: null, completed_on: null, status_reason: null, notes: null, contributed_by: null, ...extra });
  const plan = (id: string, status: string, items: TreatmentItem[]): TreatmentPlan =>
    ({ id, title: `Plan ${id}`, status, version: 1, group_id: null, alternative_of: null, presented_by: null, presented_on: null, accepted_on: null, notes: null, contributed_by: null, recorded_at: "2026-01-01T00:00:00Z", items });
  it("separates proposed from accepted work, and counts completed treatment of the last 12 months", () => {
    const s = buildDentalSummary({ ...base, plans: [
      plan("a", "accepted", [
        item("1", "Crown", "accepted", { teeth: [46] }), item("2", "Filling", "scheduled", { teeth: [16], scheduled_for: "2026-12-01" }), item("3", "Scaling", "proposed"),
        item("4", "Extraction", "deferred", { teeth: [38] }), item("5", "Old filling", "completed", { teeth: [26], completed_on: "2026-03-01" }),
        item("6", "Ancient", "completed", { teeth: [27], completed_on: "2025-10-31" }), item("7", "Dropped", "cancelled"), item("8", "Referred", "referred"),
      ]),
    ] });
    expect(s.treatment.accepted.map((i) => i.id)).toEqual(["2", "1"]);
    expect(s.treatment.proposed.map((i) => i.id)).toEqual(["4", "3"]);
    expect(s.treatment.completed.map((i) => i.id)).toEqual(["5"]);
    expect(s.treatment.completedSince).toBe("2025-11-01");
  });
  it("does not count work of a superseded plan as pending, and counts a completed treatment carried to a new version once", () => {
    const s = buildDentalSummary({ ...base, plans: [
      plan("v1", "superseded", [item("a", "Crown", "accepted", { teeth: [46] }), item("b", "Filling", "completed", { teeth: [16], completed_on: "2026-05-05", catalog_code: "filling" })]),
      plan("v2", "accepted", [item("c", "Crown", "accepted", { teeth: [46] }), item("d", "Filling", "completed", { teeth: [16], completed_on: "2026-05-05", catalog_code: "filling" })]),
    ] });
    expect(s.treatment.accepted.map((i) => i.id)).toEqual(["c"]);
    expect(s.treatment.completed).toHaveLength(1);
  });
});

describe("safety alerts and the next recall", () => {
  const alert = (code: string, severity: SafetyAlert["severity"]): SafetyAlert =>
    ({ code, severity, title_ar: code, title_en: code, message_ar: "", message_en: "", reference: null, reasons: [], items: [], drugs: [], reviewed: true });
  it("lists alerts most serious first", () => {
    const s = buildDentalSummary({ ...base, safety: [alert("a", "info"), alert("b", "danger"), alert("c", "warn")] });
    expect(s.safety.map((a) => a.code)).toEqual(["b", "c", "a"]);
  });
  it("takes the earliest active recall, with its state", () => {
    const r = (kind: string, due_on: string, status = "active") => ({ kind, label: null, interval_months: 6, due_on, status });
    const s = buildDentalSummary({ ...base, recalls: [r("dental_cleaning", "2027-02-01"), r("dental_checkup", "2026-10-01"), r("dental_xray", "2026-01-01", "paused")] });
    expect(s.recall).toMatchObject({ kind: "dental_checkup", due_on: "2026-10-01", state: "overdue" });
    expect(buildDentalSummary({ ...base, recalls: [r("dental_checkup", "2026-11-15")] }).recall?.state).toBe("due_soon");
    expect(buildDentalSummary({ ...base, recalls: [r("dental_checkup", "2027-05-15", "stopped")] }).recall).toBeNull();
  });
});
