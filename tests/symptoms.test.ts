import { describe, expect, it } from "vitest";
import { groupSymptoms, symptomSeries, type SymptomPoint } from "@/lib/symptoms";

const rows: SymptomPoint[] = [
  { id: "1", symptom: "Headache", severity: 6, onset_at: "2026-10-01T08:00:00Z", ended_at: "2026-10-01T12:00:00Z" },
  { id: "2", symptom: "headache ", severity: 3, onset_at: "2026-10-05T08:00:00Z", ended_at: null },
  { id: "3", symptom: "Cough", severity: null, onset_at: "2026-10-03T08:00:00Z", ended_at: "2026-10-04T08:00:00Z" },
  { id: "4", symptom: "صُداع", severity: 8, onset_at: "2026-09-01T08:00:00Z", ended_at: null },
  { id: "5", symptom: "صداع", severity: 2, onset_at: "2026-09-10T08:00:00Z", ended_at: null },
];

describe("symptom groups", () => {
  const groups = groupSymptoms(rows);
  it("merges spellings that differ in case, spacing or Arabic diacritics, most recent first", () => {
    expect(groups.map((g) => [g.label, g.n])).toEqual([["headache", 2], ["Cough", 1], ["صداع", 2]]);
    expect(groups[0].raw.sort()).toEqual(["Headache", "headache "]);
  });
  it("a group is ongoing while any entry has no end", () => {
    expect(groups.map((g) => g.ongoing)).toEqual([true, false, true]);
  });
});

describe("severity series", () => {
  const groups = groupSymptoms(rows);
  it("plots severity over time in order, one series per symptom", () => {
    const [s] = symptomSeries(rows, groups[0]);
    expect(s.pts.map((p) => [p.id, p.v])).toEqual([["1", 6], ["2", 3]]);
    expect(s.unit).toBe("/10");
  });
  it("leaves out entries without a severity", () => {
    expect(symptomSeries(rows, groups[1])[0].pts).toEqual([]);
  });
  it("keeps Arabic spellings together", () => {
    expect(symptomSeries(rows, groups[2])[0].pts.map((p) => p.v)).toEqual([8, 2]);
  });
});
