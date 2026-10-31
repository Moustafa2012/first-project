import { describe, expect, it } from "vitest";
import { bodyMetrics, contextPackYears, coreGaps, matchHighlights, type ClinicalContextData, type HighlightRule } from "@/lib/clinical-context";

const rule = (r: Partial<HighlightRule>): HighlightRule => ({
  specialty_code: "dentistry", source: "condition", keywords: [], device_kinds: [], level: "warn", message_ar: "رسالة", message_en: "message", sort: 0,
  reviewed_by_clinician: false, ...r,
});
const base = (over: Partial<ClinicalContextData> = {}): ClinicalContextData => ({
  patient: { date_of_birth: "1990-01-01", sex: "female", blood_abo: null, blood_rh: null, blood_group_verified: false, allergy_assertion: "unknown" },
  body: {}, allergies: [], conditions: [], medications: [], devices: [], lifestyle: null, highlights: [], ...over,
});
const life = { tobacco_status: "unknown", tobacco_types: [], cigarettes_per_day: null, waterpipe_per_week: null, tobacco_start_year: null, tobacco_quit_year: null,
  activity_level: null, none_chronic_conditions: false, none_long_term_medications: false, none_devices: false };

describe("clinical context", () => {
  it("derives height in cm, weight in kg and BMI from the recorded units", () => {
    expect(bodyMetrics({ height: { value: 1.7, unit: "m", at: "" }, weight: { value: 84, unit: "kg", at: "" } }).bmi).toBeCloseTo(29.07, 2);
    expect(bodyMetrics({ weight: { value: 70, unit: "kg", at: "" } }).bmi).toBeNull();
    expect(bodyMetrics(null).cm).toBeNull();
  });
  it("counts pack-years to the quit year for a former smoker", () => {
    expect(contextPackYears({ ...life, tobacco_status: "former", tobacco_types: ["cigarettes"], cigarettes_per_day: 20, tobacco_start_year: 2000, tobacco_quit_year: 2010 })).toBe(10);
    expect(contextPackYears({ ...life, tobacco_status: "current", tobacco_types: ["waterpipe"], cigarettes_per_day: 20, tobacco_start_year: 2000 })).toBeNull();
  });
  it("matches specialty reminders against the record, ignoring diacritics and letter forms", () => {
    const ctx = base({
      conditions: [{ name: "تضيّق خِلقي في الشريان الأبهر", category: "congenital", clinical_status: "active", certainty: "confirmed" }],
      medications: [{ name: "Warfarin", strength: "5 mg", dose: null, frequency: null, long_term: true, status: "active" }],
      devices: [{ kind: "prosthetic_heart_valve", name: "Mechanical valve", body_site: null, implanted_on: null, date_precision: null, mri_safety: "unknown" }],
      lifestyle: { ...life, tobacco_status: "current", pregnancy_status: "pregnant" },
      highlights: [
        rule({ keywords: ["الشريان الابهر"], message_en: "heart", level: "warn" }),
        rule({ source: "medication", keywords: ["warfarin"], message_en: "bleeding", level: "bad" }),
        rule({ source: "device", device_kinds: ["prosthetic_heart_valve"], message_en: "valve", level: "bad" }),
        rule({ source: "tobacco", message_en: "smoker", level: "info" }),
        rule({ source: "pregnancy", message_en: "pregnant" }),
        rule({ specialty_code: "radiology", source: "pregnancy", message_en: "radiology only" }),
        rule({ source: "allergy", keywords: ["penicillin"], message_en: "no allergy here" }),
      ],
    });
    const hl = matchHighlights(ctx, ["dentistry"]);
    expect(hl.map((h) => h.message_en)).toEqual(["bleeding", "valve", "heart", "pregnant", "smoker"]);
    expect(hl.find((h) => h.message_en === "heart")?.because).toEqual(["تضيّق خِلقي في الشريان الأبهر"]);
    expect(matchHighlights(ctx, "all").some((h) => h.message_en === "radiology only")).toBe(true);
    expect(matchHighlights(ctx, ["cardiology"])).toEqual([]);
  });
  it("lists what is missing, honouring explicit 'none known' statements", () => {
    const empty = coreGaps(base()).map((g) => g.key);
    expect(empty).toEqual(["height", "weight", "blood", "allergies", "conditions", "meds", "devices", "tobacco", "pregnancy"]);
    const filled = coreGaps(base({
      patient: { date_of_birth: "1950-01-01", sex: "male", blood_abo: "O", blood_rh: "+", blood_group_verified: true, allergy_assertion: "none_known" },
      body: { height: { value: 170, unit: "cm", at: "" }, weight: { value: 70, unit: "kg", at: "" } },
      lifestyle: { ...life, tobacco_status: "never", none_chronic_conditions: true, none_long_term_medications: true, none_devices: true },
    }));
    expect(filled).toEqual([]);
  });
});
