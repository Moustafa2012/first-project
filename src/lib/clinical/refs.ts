/** Dashed guide lines on charts (general adult values, in the type's default unit). Not diagnostic thresholds. */
export const REF_LINES: Record<string, { v: number; label: string }[]> = {
  blood_pressure: [{ v: 120, label: "120" }, { v: 80, label: "80" }],
  heart_rate: [{ v: 60, label: "60" }, { v: 100, label: "100" }],
  spo2: [{ v: 95, label: "95" }],
  body_temperature: [{ v: 37.5, label: "37.5" }],
  blood_glucose: [{ v: 70, label: "70" }, { v: 100, label: "100" }],
};
