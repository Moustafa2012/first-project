import { normText } from "@/lib/dedupe";
import { ageAt, bmi, packYears, toDefaultUnit } from "@/lib/clinical/derived";

/**
 * The core context every section needs (age, sex, blood group, height and weight, allergies, chronic conditions,
 * medications, devices, lifestyle, pregnancy), in one shape for the patient's pages and for the shared view
 * (public.share_context returns exactly this).
 */
export interface BodyValue { value: number; unit: string | null; at: string }
export interface HighlightRule {
  specialty_code: string | null; source: "condition" | "medication" | "allergy" | "device" | "pregnancy" | "tobacco";
  keywords: string[]; device_kinds: string[]; level: "info" | "warn" | "bad"; message_ar: string; message_en: string;
  sort: number; reviewed_by_clinician: boolean;
}
export interface Lifestyle {
  tobacco_status: string; tobacco_types: string[]; cigarettes_per_day: number | null; waterpipe_per_week: number | null;
  tobacco_start_year: number | null; tobacco_quit_year: number | null; alcohol_status?: string | null; activity_level: string | null;
  pregnancy_status?: string | null; pregnancy_edd?: string | null; breastfeeding?: boolean | null;
  none_chronic_conditions: boolean; none_long_term_medications: boolean; none_devices: boolean;
}
export interface ClinicalContextData {
  patient: { date_of_birth: string; sex: string; blood_abo: string | null; blood_rh: string | null; blood_group_verified: boolean; allergy_assertion: string };
  body: { height?: BodyValue; weight?: BodyValue } | null;
  allergies: { substance: string; category: string; reaction: string | null; severity: string | null; certainty: string }[];
  conditions: { name: string; category: string; clinical_status: string; certainty: string }[];
  medications: { name: string; strength: string | null; dose: string | null; frequency: string | null; long_term: boolean; status: string }[];
  devices: { kind: string; name: string | null; body_site: string | null; implanted_on: string | null; date_precision: string | null; mri_safety: string }[];
  lifestyle: Lifestyle | null;
  highlights: HighlightRule[];
}

/** Height in cm and weight in kg from whatever unit was recorded (null when the unit is unknown). */
export function bodyMetrics(body: ClinicalContextData["body"]) {
  const h = body?.height, w = body?.weight;
  const cm = h ? toDefaultUnit(Number(h.value), h.unit, "cm", { m: 100, in: 2.54 }) : null;
  const kg = w ? toDefaultUnit(Number(w.value), w.unit, "kg", { lb: 0.45359237 }) : null;
  return { cm, kg, bmi: bmi(kg, cm) };
}

/** Pack-years for cigarettes, from the daily amount and the years smoked (to the quit year, or now). */
export function contextPackYears(l: Lifestyle | null, now = new Date()): number | null {
  if (!l || !l.cigarettes_per_day || !l.tobacco_start_year || !l.tobacco_types.includes("cigarettes")) return null;
  const end = l.tobacco_status === "former" && l.tobacco_quit_year ? l.tobacco_quit_year : now.getUTCFullYear();
  return packYears(Number(l.cigarettes_per_day), end - l.tobacco_start_year);
}

export const ageOf = (dob: string, now = new Date()) => ageAt(dob, now);

export interface Highlight { level: HighlightRule["level"]; message_ar: string; message_en: string; because: string[]; reviewed: boolean }

/**
 * The reminders that matter to a specialty, found by matching its rules against the record (names compared without
 * diacritics or letter-form differences). A reminder to review, never a diagnosis.
 * `codes`: the specialties being viewed; "all" applies every rule (a whole-file share).
 */
export function matchHighlights(ctx: ClinicalContextData, codes: string[] | "all"): Highlight[] {
  const applies = (r: HighlightRule) => r.specialty_code == null || codes === "all" || codes.includes(r.specialty_code);
  const hit = (names: string[], keywords: string[]) => {
    const keys = keywords.map(normText).filter(Boolean);
    return names.filter((n) => { const x = normText(n); return keys.some((k) => x.includes(k)); });
  };
  const out: Highlight[] = [];
  const seen = new Set<string>();
  for (const r of [...ctx.highlights].sort((a, b) => a.sort - b.sort)) {
    if (!applies(r)) continue;
    let because: string[] = [];
    switch (r.source) {
      case "condition": because = hit(ctx.conditions.map((c) => c.name), r.keywords); break;
      case "medication": because = hit(ctx.medications.map((m) => m.name), r.keywords); break;
      case "allergy": because = hit(ctx.allergies.map((a) => a.substance), r.keywords); break;
      case "device": because = ctx.devices.filter((d) => r.device_kinds.includes(d.kind)).map((d) => d.name || d.kind); break;
      case "pregnancy": because = ctx.lifestyle?.pregnancy_status === "pregnant" ? ["pregnancy"] : []; break;
      case "tobacco": because = ctx.lifestyle?.tobacco_status === "current" ? ["tobacco"] : []; break;
    }
    if (!because.length || seen.has(r.message_en)) continue;
    seen.add(r.message_en);
    out.push({ level: r.level, message_ar: r.message_ar, message_en: r.message_en, because, reviewed: r.reviewed_by_clinician });
  }
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** What is still missing from the core file (each with the section of the core-file page that completes it). */
export function coreGaps(ctx: ClinicalContextData): { key: string; anchor: string; ar: string; en: string }[] {
  const g: { key: string; anchor: string; ar: string; en: string }[] = [];
  const l = ctx.lifestyle;
  if (!ctx.body?.height) g.push({ key: "height", anchor: "body", ar: "الطول", en: "Height" });
  if (!ctx.body?.weight) g.push({ key: "weight", anchor: "body", ar: "الوزن", en: "Weight" });
  if (!ctx.patient.blood_abo) g.push({ key: "blood", anchor: "identity", ar: "فصيلة الدم", en: "Blood group" });
  if (ctx.patient.allergy_assertion === "unknown") g.push({ key: "allergies", anchor: "allergies", ar: "الحساسية (موجودة أم لا)", en: "Allergies (any or none)" });
  if (!ctx.conditions.length && !l?.none_chronic_conditions) g.push({ key: "conditions", anchor: "conditions", ar: "الأمراض المزمنة (موجودة أم لا)", en: "Chronic conditions (any or none)" });
  if (!ctx.medications.some((m) => m.long_term) && !l?.none_long_term_medications) g.push({ key: "meds", anchor: "medications", ar: "الأدوية الدائمة (موجودة أم لا)", en: "Long-term medications (any or none)" });
  if (!ctx.devices.length && !l?.none_devices) g.push({ key: "devices", anchor: "devices", ar: "الأجهزة والزرعات (موجودة أم لا)", en: "Devices & implants (any or none)" });
  if (!l || l.tobacco_status === "unknown") g.push({ key: "tobacco", anchor: "lifestyle", ar: "التدخين", en: "Tobacco" });
  if (ctx.patient.sex !== "male" && (!l || l.pregnancy_status === "unknown") && ageOf(ctx.patient.date_of_birth) >= 12 && ageOf(ctx.patient.date_of_birth) <= 55) {
    g.push({ key: "pregnancy", anchor: "lifestyle", ar: "الحمل", en: "Pregnancy" });
  }
  return g;
}
