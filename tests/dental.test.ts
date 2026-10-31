import { describe, expect, it } from "vitest";
import {
  ARCHES, archesFor, chartDentition, chartSummary, compareExams, deriveChart, fmtSurfaces, isFdi, parseTeeth, surfaceCode, surfaceFromKey,
  surfaceSide, surfaceTone, toothName, toothType, type ExamRow, type FindingRow,
} from "@/lib/dental";

const exam = (id: string, date: string, states: [number, string][], extra: Partial<ExamRow> = {}): ExamRow =>
  ({ id, exam_date: date, kind: "comprehensive", dentition: "permanent", states: states.map(([tooth, status]) => ({ tooth, status })), ...extra });
const finding = (id: string, tooth: number, kind: string, surfaces: string[], observed_on: string, extra: Partial<FindingRow> = {}): FindingRow =>
  ({ id, exam_id: null, tooth, kind, surfaces, evidence: "clinical", observed_on, ...extra });

describe("FDI numbering", () => {
  it("accepts permanent 11–48 and primary 51–85 only", () => {
    expect([11, 18, 28, 38, 48, 51, 55, 65, 75, 85].every(isFdi)).toBe(true);
    expect([10, 19, 49, 56, 86, 91, 0, 1.5].some(isFdi)).toBe(false);
  });
  it("lays out the arches facing the patient (patient's right on the left)", () => {
    expect(ARCHES.permanentUpper.slice(0, 3)).toEqual([18, 17, 16]);
    expect(ARCHES.permanentUpper.slice(7, 10)).toEqual([11, 21, 22]);
    expect(ARCHES.permanentLower.at(-1)).toBe(38);
    expect(ARCHES.primaryLower).toEqual([85, 84, 83, 82, 81, 71, 72, 73, 74, 75]);
    expect(archesFor("mixed")).toHaveLength(4);
    expect(archesFor("permanent").flat()).toHaveLength(32);
    expect(archesFor("primary").flat()).toHaveLength(20);
  });
  it("names teeth", () => {
    expect(toothType(13)).toBe("canine");
    expect(toothType(54)).toBe("molar");
    expect(toothName(18, "en")).toBe("upper right third (wisdom) molar");
    expect(toothName(36, "ar")).toBe("رحى أول سفلي أيسر");
    expect(toothName(61, "en")).toBe("upper left central primary incisor");
  });
  it("parses lists of teeth, including Arabic digits", () => {
    expect(parseTeeth("16, 26 ٣٦")).toEqual([16, 26, 36]);
    expect(parseTeeth("16،16")).toEqual([16]);
    expect(parseTeeth("")).toEqual([]);
    expect(parseTeeth("16, 19")).toBeNull();
  });
});

describe("surfaces", () => {
  it("names surfaces per tooth", () => {
    expect(surfaceCode("O", 11)).toBe("I");
    expect(surfaceCode("B", 21)).toBe("La");
    expect(surfaceCode("L", 16)).toBe("P");
    expect(surfaceCode("L", 36)).toBe("L");
    expect(fmtSurfaces(["D", "O", "M"], 16)).toBe("MOD");
    expect(fmtSurfaces(["O", "M"], 11)).toBe("MI");
  });
  it("draws mesial toward the midline and facial away from the bite", () => {
    expect(surfaceSide("M", 16)).toBe("right");   // patient's right, drawn on the viewer's left
    expect(surfaceSide("M", 26)).toBe("left");
    expect(surfaceSide("D", 46)).toBe("left");
    expect(surfaceSide("B", 16)).toBe("top");
    expect(surfaceSide("B", 36)).toBe("bottom");
    expect(surfaceSide("L", 36)).toBe("top");
    expect(surfaceSide("O", 36)).toBe("center");
  });
  it("maps keyboard letters", () => {
    expect(surfaceFromKey("i", 11)).toBe("O");
    expect(surfaceFromKey("I", 16)).toBeNull();
    expect(surfaceFromKey("p", 16)).toBe("L");
    expect(surfaceFromKey("p", 36)).toBeNull();
    expect(surfaceFromKey("d", 36)).toBe("D");
  });
});

describe("chart derivation", () => {
  const exams = [
    exam("e1", "2024-01-10", [[16, "present"], [18, "present"], [28, "impacted"]]),
    exam("e2", "2025-06-01", [[18, "extracted"], [28, "not_examined"]], { dentition: "permanent" }),
  ];
  const findings = [
    finding("f1", 16, "caries", ["O", "M"], "2024-01-10", { exam_id: "e1" }),
    finding("f2", 16, "filling", ["O", "M"], "2025-06-01", { exam_id: "e2" }),
    finding("f3", 46, "crown", [], "2019-01-01"),
  ];
  findings[0].resolved_on = "2025-06-01";

  it("takes each tooth's state from the latest exam that looked at it", () => {
    const c = deriveChart(exams, findings);
    expect(c.get(18)?.status).toBe("extracted");
    expect(c.get(28)?.status).toBe("impacted");   // "not examined" later does not erase it
    expect(c.get(11)).toBeUndefined();             // never examined: no state, not "healthy"
  });
  it("keeps only unresolved findings, newest first", () => {
    const c = deriveChart(exams, findings);
    expect(c.get(16)?.findings.map((f) => f.id)).toEqual(["f2"]);
    expect(c.get(46)?.findings.map((f) => f.id)).toEqual(["f3"]);
  });
  it("can show the chart as it was on a date", () => {
    const c = deriveChart(exams, findings, "2024-12-31");
    expect(c.get(18)?.status).toBe("present");
    expect(c.get(16)?.findings.map((f) => f.id)).toEqual(["f1"]);
  });
  it("colours surfaces: disease over existing work", () => {
    const f = [finding("a", 16, "filling", ["O"], "2024-01-01"), finding("b", 16, "secondary_caries", ["O"], "2024-02-01")];
    expect(surfaceTone(f, "O")).toBe("disease");
    expect(surfaceTone(f.slice(0, 1), "O")).toBe("work");
    expect(surfaceTone(f, "M")).toBeNull();
  });
  it("summarises", () => {
    expect(chartSummary(deriveChart(exams, findings))).toEqual({ examined: 3, absent: 1, disease: 0, work: 2 });
  });
  it("chooses the dentition to draw", () => {
    expect(chartDentition(null, [])).toBe("permanent");
    expect(chartDentition({ dentition: "mixed" }, exams)).toBe("mixed");
    expect(chartDentition(null, [exam("x", "2020-01-01", [], { dentition: "primary" })])).toBe("primary");
  });
  it("compares two exams tooth by tooth", () => {
    const ch = compareExams(exams[1], exams[0], findings);
    expect(ch.map((c) => c.tooth)).toEqual([16, 18, 28]);
    expect(ch.find((c) => c.tooth === 18)).toMatchObject({ before: "present", after: "extracted" });
    expect(ch.find((c) => c.tooth === 16)?.added.map((f) => f.kind)).toEqual(["filling"]);
    expect(ch.find((c) => c.tooth === 16)?.removed.map((f) => f.kind)).toEqual(["caries"]);
    expect(ch.find((c) => c.tooth === 28)).toMatchObject({ before: "impacted", after: null });
  });
});

describe("whole-tooth work", () => {
  it("a crown shades every surface, disease still shows on top", () => {
    const crown = finding("c", 36, "crown", [], "2024-01-01");
    expect(surfaceTone([crown], "M")).toBe("work");
    expect(surfaceTone([crown, finding("d", 36, "secondary_caries", ["M"], "2025-01-01")], "M")).toBe("disease");
    expect(surfaceTone([finding("r", 36, "root_canal", [], "2024-01-01")], "O")).toBeNull();
  });
});

describe("dental links", () => {
  it("labels diagnoses for the chart, in Arabic or English, ignoring diacritics", async () => {
    const { diagnosisCode } = await import("@/lib/dental");
    expect(diagnosisCode("خراج سني مستمر (ناب مهتز) مع نخور")).toBe("ABS");
    expect(diagnosisCode("Irreversible pulpitis")).toBe("PULP");
    expect(diagnosisCode("تسوّس عميق")).toBe("CAR");
    expect(diagnosisCode("something rare")).toBe("DX");
  });
  it("puts open problems, procedures and images on their teeth", async () => {
    const { toothLinks } = await import("@/lib/dental");
    const m = toothLinks(
      [{ id: "a", name: "Abscess", teeth: [13], clinical_status: "active" }, { id: "b", name: "Caries", teeth: [13, 14], clinical_status: "resolved" },
       { id: "c", name: "Pulpitis", teeth: [36], clinical_status: "active", certainty: "refuted" }, { id: "d", name: "Pain", teeth: null }],
      [{ id: "p", name: "Root canal", teeth: [13] }], [{ id: "i", modality: "dental_xray", teeth: [13, 14] }]);
    expect(m.get(13)).toEqual({ problems: [{ name: "Abscess", code: "ABS" }], procedures: 1, images: 1 });
    expect(m.get(14)).toEqual({ problems: [], procedures: 0, images: 1 });
    expect(m.has(36)).toBe(false);
  });
});
