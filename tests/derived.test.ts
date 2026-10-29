import { describe, expect, it } from "vitest";
import { ageAt, bmi, bmiClass, egfrCkdEpi2021, gfrCategory, homaIr, packYears, toDefaultUnit } from "@/lib/clinical/derived";
import { fmtPartialDate, normalizePartialDate } from "@/lib/format";
import { normText, sameMinute, sameNumber, within } from "@/lib/dedupe";

describe("derived values", () => {
  it("computes BMI and its WHO class", () => {
    expect(bmi(84, 170)).toBeCloseTo(29.07, 2);
    expect(bmiClass(29.07)).toBe("overweight");
    expect(bmiClass(18.4)).toBe("underweight");
    expect(bmiClass(31)).toBe("obese1");
    expect(bmi(84, null)).toBeNull();
    expect(bmi(84, 20)).toBeNull();
  });

  it("follows the 2021 CKD-EPI creatinine equation", () => {
    expect(egfrCkdEpi2021(1.0, 50, "female")).toBeCloseTo(68.6, 0);
    expect(egfrCkdEpi2021(1.12, 28, "male")).toBeCloseTo(91.8, 0);
    expect(egfrCkdEpi2021(0.54, 28, "male")).toBeCloseTo(139.2, 0);
    expect(egfrCkdEpi2021(1.0, 16, "male")).toBeNull();
    expect(egfrCkdEpi2021(1.0, 40, "unspecified")).toBeNull();
    expect(gfrCategory(91.8)).toBe("G1");
    expect(gfrCategory(59)).toBe("G3a");
    expect(gfrCategory(10)).toBe("G5");
  });

  it("computes HOMA-IR and pack-years", () => {
    expect(homaIr(90, 10)).toBeCloseTo(2.22, 2);
    expect(homaIr(null, 10)).toBeNull();
    expect(packYears(20, 14)).toBe(14);
    expect(packYears(0, 14)).toBeNull();
  });

  it("converts to the default unit only through the type's table", () => {
    expect(toDefaultUnit(80, "µmol/L", "mg/dL", { "µmol/L": 0.011312 })).toBeCloseTo(0.905, 3);
    expect(toDefaultUnit(1.1, "mg/dL", "mg/dL", {})).toBe(1.1);
    expect(toDefaultUnit(1.1, "g/L", "mg/dL", {})).toBeNull();
  });

  it("computes the age at a given date", () => {
    expect(ageAt("1998-03-12", "2026-03-11T12:00:00Z")).toBe(27);
    expect(ageAt("1998-03-12", "2026-03-12T12:00:00Z")).toBe(28);
  });
});

describe("partial dates", () => {
  it("stores only the known part", () => {
    expect(normalizePartialDate("2003-06-17", "month")).toBe("2003-06-01");
    expect(normalizePartialDate("2003-06-17", "year")).toBe("2003-01-01");
    expect(normalizePartialDate("2003-06-17", "approx")).toBe("2003-01-01");
    expect(normalizePartialDate("2003-06-17", "day")).toBe("2003-06-17");
  });
  it("never shows more detail than recorded", () => {
    expect(fmtPartialDate("2003-01-01", "year", "en")).toBe("2003");
    expect(fmtPartialDate("2003-01-01", "approx", "ar")).toBe("حوالي 2003");
    expect(fmtPartialDate("2003-03-01", "month", "en")).toBe("March 2003");
    expect(fmtPartialDate("2003-03-05", "day", "en")).toBe("5 Mar 2003");
    expect(fmtPartialDate(null, "year", "en")).toBe("");
  });
});

describe("duplicate detection helpers", () => {
  it("folds Arabic spelling variants, diacritics and spacing", () => {
    expect(normText("  السُّكَّري  ")).toBe(normText("السكري"));
    expect(normText("حساسية موسمية (ربيعية)")).toBe(normText("حساسيه موسميه ربيعيه"));
    expect(normText("Augmentin")).toBe(normText("augmentin "));
    expect(normText("أسبرين")).toBe(normText("اسبرين"));
  });
  it("compares times and numbers tolerantly", () => {
    expect(sameMinute("2026-10-24T08:58:00Z", "2026-10-24T08:58:30Z")).toBe(true);
    expect(sameMinute("2026-10-24T08:58:00Z", "2026-10-24T09:58:00Z")).toBe(false);
    expect(within("2026-10-24T08:58:00Z", "2026-10-24T18:00:00Z", 12)).toBe(true);
    expect(sameNumber(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameNumber("14.8", 14.8)).toBe(true);
    expect(sameNumber(14.8, 14.9)).toBe(false);
  });
});
