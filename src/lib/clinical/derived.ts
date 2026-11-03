/**
 * Values computed from recorded results. They are never stored: they follow the inputs whenever those are corrected.
 * Each one is a screening aid for adults and carries the inputs it was computed from.
 */

export type Sex = "male" | "female" | "intersex" | "unspecified" | string;

/** Body-mass index (kg/m²) for adults; null when an input is missing or implausible. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm < 50 || heightCm > 260) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export type BmiClass = "underweight" | "normal" | "overweight" | "obese1" | "obese2" | "obese3";
/** WHO adult categories. */
export function bmiClass(v: number): BmiClass {
  if (v < 18.5) return "underweight";
  if (v < 25) return "normal";
  if (v < 30) return "overweight";
  if (v < 35) return "obese1";
  if (v < 40) return "obese2";
  return "obese3";
}

/**
 * eGFR by the 2021 race-free CKD-EPI creatinine equation (mL/min/1.73m²).
 * Defined for adults with a recorded male or female sex only; otherwise null (the equation needs one of the two).
 */
export function egfrCkdEpi2021(creatinineMgDl: number | null | undefined, ageYears: number, sex: Sex): number | null {
  if (!creatinineMgDl || creatinineMgDl <= 0 || ageYears < 18) return null;
  if (sex !== "male" && sex !== "female") return null;
  const female = sex === "female";
  const k = female ? 0.7 : 0.9;
  const a = female ? -0.241 : -0.302;
  const r = creatinineMgDl / k;
  return 142 * Math.pow(Math.min(r, 1), a) * Math.pow(Math.max(r, 1), -1.2) * Math.pow(0.9938, ageYears) * (female ? 1.012 : 1);
}

export type GfrCategory = "G1" | "G2" | "G3a" | "G3b" | "G4" | "G5";
/** KDIGO GFR categories (meaningful for kidney disease only together with duration and other markers). */
export function gfrCategory(v: number): GfrCategory {
  if (v >= 90) return "G1";
  if (v >= 60) return "G2";
  if (v >= 45) return "G3a";
  if (v >= 30) return "G3b";
  if (v >= 15) return "G4";
  return "G5";
}

/** HOMA-IR from a fasting glucose (mg/dL) and fasting insulin (µIU/mL) taken together. */
export function homaIr(fastingGlucoseMgDl: number | null | undefined, fastingInsulin: number | null | undefined): number | null {
  if (!fastingGlucoseMgDl || !fastingInsulin || fastingGlucoseMgDl <= 0 || fastingInsulin <= 0) return null;
  return (fastingGlucoseMgDl * fastingInsulin) / 405;
}

/** Pack-years: packs (20 cigarettes) a day × years smoked. */
export function packYears(cigarettesPerDay: number, years: number): number | null {
  if (!(cigarettesPerDay > 0) || !(years > 0)) return null;
  return (cigarettesPerDay / 20) * years;
}

/** Converts a value in `unit` to the type's default unit using its conversion table; null when the unit is unknown. */
export function toDefaultUnit(value: number, unit: string | null, defaultUnit: string | null, conversions: Record<string, number> | null | undefined): number | null {
  if (!unit || unit === defaultUnit) return value;
  const f = conversions?.[unit];
  return typeof f === "number" ? value * f : null;
}

/** Whole years between a date of birth and a moment (UTC dates). */
export function ageAt(dob: string, at: string | Date): number {
  const d = new Date(at);
  const [y, m, day] = dob.split("-").map(Number);
  let age = d.getUTCFullYear() - y;
  if (d.getUTCMonth() + 1 < m || (d.getUTCMonth() + 1 === m && d.getUTCDate() < day)) age -= 1;
  return age;
}
