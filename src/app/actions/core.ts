"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { getObsTypes } from "@/lib/data";
import { parseLocaleNumber } from "@/lib/clinical/number";
import { ACTIVITY_LEVEL, ALCOHOL_STATUS, PREGNANCY_STATUS, TOBACCO_STATUS, TOBACCO_TYPE, type Opt } from "@/lib/labels";
import type { FormState } from "@/components/ui/client";

const str = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? "").trim().slice(0, max);
const has = (list: Opt[], v: string) => list.some((x) => x.value === v);
const done = (pid: string) => { revalidatePath(`/patients/${pid}`, "layout"); };

/** Height and weight from the core file: saved as measurements, so the core file, the vitals page and BMI share one source. */
export async function saveBody(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const when = new Date(str(fd, "measured_at") || Date.now());
  if (Number.isNaN(+when) || +when > Date.now() + 60_000) return { error: t("وقت القياس غير صالح.", "Invalid measurement time.") };
  const types = await getObsTypes();
  const rows: Record<string, unknown>[] = [];
  for (const [code, field, lo, hi, unit] of [["height", "height_cm", 20, 260, "cm"], ["weight", "weight_kg", 0.3, 700, "kg"]] as const) {
    const raw = str(fd, field, 20);
    if (!raw) continue;
    const v = parseLocaleNumber(raw);
    if (v == null || v < lo || v > hi) {
      return { error: code === "height" ? t("أدخل الطول بالسنتيمتر (20–260).", "Enter the height in centimetres (20–260).") : t("أدخل الوزن بالكيلوغرام (0.3–700).", "Enter the weight in kilograms (0.3–700).") };
    }
    const type = types.find((x) => x.code === code);
    if (type) rows.push({ patient_id: pid, type_id: type.id, value_num: v, unit, effective_at: when.toISOString(), setting: "home", source: "self" });
  }
  if (!rows.length) return { error: t("أدخل الطول أو الوزن.", "Enter the height or the weight.") };
  const { error } = await createClient().from("observations").insert(rows);
  if (error) return { error: explainError(error, t) };
  done(pid);
  return { ok: true, message: t("حُفظ وسُجّل في القياسات.", "Saved, and recorded under vitals.") };
}

/** Lifestyle (tobacco, alcohol, activity, occupation, exposures) and pregnancy / breastfeeding: one row per patient. */
export async function saveHealthProfile(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const tobacco = str(fd, "tobacco_status") || "unknown", alcohol = str(fd, "alcohol_status") || "unknown";
  const activity = str(fd, "activity_level"), preg = str(fd, "pregnancy_status") || "unknown";
  if (!has(TOBACCO_STATUS, tobacco) || !has(ALCOHOL_STATUS, alcohol) || (activity && !has(ACTIVITY_LEVEL, activity)) || !has(PREGNANCY_STATUS, preg)) {
    return { error: t("اختيار غير صالح.", "Invalid choice.") };
  }
  const smokes = tobacco === "current" || tobacco === "former";
  const types = smokes ? fd.getAll("tobacco_types").map(String).filter((x) => has(TOBACCO_TYPE, x)) : [];
  const num = (k: string, lo: number, hi: number) => {
    const raw = str(fd, k, 20);
    if (!raw) return null;
    const v = parseLocaleNumber(raw);
    return v != null && v >= lo && v <= hi ? v : NaN;
  };
  const cpd = smokes ? num("cigarettes_per_day", 0, 200) : null, wpw = smokes ? num("waterpipe_per_week", 0, 100) : null;
  const start = smokes ? num("tobacco_start_year", 1900, 2100) : null, quit = tobacco === "former" ? num("tobacco_quit_year", 1900, 2100) : null;
  const units = alcohol === "regular" || alcohol === "occasional" ? num("alcohol_units_per_week", 0, 300) : null;
  if ([cpd, wpw, start, quit, units].some((x) => Number.isNaN(x))) return { error: t("رقم غير صالح.", "Invalid number.") };
  if (start && quit && quit < start) return { error: t("سنة الإقلاع قبل سنة البدء.", "The quit year is before the start year.") };
  const edd = preg === "pregnant" ? str(fd, "pregnancy_edd", 10) : "";
  if (edd && !/^\d{4}-\d{2}-\d{2}$/.test(edd)) return { error: t("تاريخ غير صالح.", "Invalid date.") };
  const bf = str(fd, "breastfeeding");
  const { error } = await createClient().from("patient_health_profile").upsert({
    patient_id: pid, tobacco_status: tobacco, tobacco_types: types, cigarettes_per_day: cpd, waterpipe_per_week: wpw,
    tobacco_start_year: start ? Math.round(start) : null, tobacco_quit_year: quit ? Math.round(quit) : null,
    alcohol_status: alcohol, alcohol_units_per_week: units, activity_level: activity || null,
    occupation: str(fd, "occupation", 200) || null, exposures: str(fd, "exposures", 1000) || null, diet: str(fd, "diet", 500) || null,
    pregnancy_status: preg, pregnancy_edd: edd || null, breastfeeding: bf === "yes" ? true : bf === "no" ? false : null,
  }, { onConflict: "patient_id" });
  if (error) return { error: explainError(error, t) };
  done(pid);
  return { ok: true, message: t("حُفظ.", "Saved.") };
}

const ASSERTIONS = ["none_chronic_conditions", "none_long_term_medications", "none_devices"];

/** "None known" for a list of the core file, so an empty list is never read as "none". */
export async function setNoneAssertion(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid"), field = str(fd, "_field");
  if (!UUID_RE.test(pid) || !ASSERTIONS.includes(field)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const value = fd.get("value") === "on";
  const supabase = createClient();
  const { data: row } = await supabase.from("patient_health_profile").select("id").eq("patient_id", pid).maybeSingle();
  const { error } = row
    ? await supabase.from("patient_health_profile").update({ [field]: value }).eq("patient_id", pid)
    : await supabase.from("patient_health_profile").insert({ patient_id: pid, [field]: value });
  if (error) return { error: explainError(error, t) };
  done(pid);
  return { ok: true, message: t("حُفظ.", "Saved.") };
}

/** The explicit allergy statement (unknown / none known / has allergies), kept apart from the identity form. */
export async function setAllergyAssertion(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid"), value = str(fd, "allergy_assertion");
  if (!UUID_RE.test(pid) || !["unknown", "none_known", "has_allergies"].includes(value)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const supabase = createClient();
  if (value === "none_known") {
    const { count } = await supabase.from("allergies").select("id", { count: "exact", head: true }).eq("patient_id", pid).eq("status", "active").eq("record_status", "active");
    if (count) return { error: t("توجد حساسيات نشطة مسجلة؛ لا يمكن تحديد «لا توجد حساسية معروفة».", "Active allergies are recorded; “no known allergies” cannot be set.") };
  }
  const { data, error } = await supabase.from("patients").update({ allergy_assertion: value }).eq("id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لا تملك صلاحية التعديل.", "You may not edit this file.") };
  done(pid);
  return { ok: true, message: t("حُفظ.", "Saved.") };
}
