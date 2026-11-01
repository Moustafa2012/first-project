"use server";
import { clearCatalogCache } from "@/lib/data";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentProfile, explainError, requireUser } from "@/lib/auth";
import { hasRecordFactor, matchFromForm } from "@/lib/safety-rules";
import { UUID_RE } from "@/lib/uuid";
import { i18n } from "@/lib/i18n";
import type { FormState } from "@/components/ui/client";

export async function saveSpecialty(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  if ((await currentProfile())?.role !== "admin") return { error: t("للمسؤولين فقط.", "Administrators only.") };
  const id = String(fd.get("_id") ?? "");
  const code = String(fd.get("code") ?? "").trim();
  const row = {
    name_ar: String(fd.get("name_ar") ?? "").trim(), name_en: String(fd.get("name_en") ?? "").trim(),
    icon: String(fd.get("icon") ?? "folder").trim().slice(0, 40) || "folder", kind: fd.get("kind") === "support" ? "support" : "clinical",
    sort: Math.trunc(Number(fd.get("sort") ?? 0)) || 0, is_active: fd.get("is_active") === "on",
  };
  if (!row.name_ar || !row.name_en) return { error: t("الاسمان العربي والإنجليزي مطلوبان.", "Arabic and English names are required.") };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from("medical_specialties").update(row).eq("id", id)
    : await supabase.from("medical_specialties").insert({ ...row, code });
  if (error) return { error: /check constraint|code/.test(error.message) ? t("الرمز: حروف إنجليزية صغيرة وأرقام و_ فقط.", "Code: lowercase letters, digits and _ only.") : explainError(error, t) };
  clearCatalogCache();
  revalidatePath("/admin/specialties");
  return { ok: true, message: t("تم الحفظ.", "Saved.") };
}

/** Adds or edits a safety rule. Changing what a rule says clears its review and raises its version (in the database). */
export async function saveSafetyRule(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  if ((await currentProfile())?.role !== "admin") return { error: t("للمسؤولين فقط.", "Administrators only.") };
  const id = String(fd.get("_id") ?? "");
  const str = (k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);
  const severity = str("severity", 10);
  if (!["info", "warn", "danger"].includes(severity)) return { error: t("اختر درجة التنبيه.", "Choose the severity.") };
  const row = {
    title_ar: str("title_ar", 120), title_en: str("title_en", 120), message_ar: str("message_ar", 700), message_en: str("message_en", 700), severity,
    specialty_code: str("specialty_code", 60) || "dentistry", reference: str("reference", 500) || null, sort: Math.trunc(Number(fd.get("sort") ?? 0)) || 0,
    is_active: fd.get("is_active") === "on", match: matchFromForm(fd),
  };
  if (row.title_ar.length < 3 || row.title_en.length < 3 || row.message_ar.length < 3 || row.message_en.length < 3) {
    return { error: t("العنوان والرسالة بالعربية والإنجليزية مطلوبان.", "The title and the message in Arabic and English are required.") };
  }
  if (!hasRecordFactor(row.match)) return { error: t("حدّد ما في الملف الذي يُفعّل القاعدة (مرض، دواء، حساسية، جهاز، حمل أو تحليل).", "Choose what in the file raises the rule (a condition, medicine, allergy, device, pregnancy or lab).") };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from("safety_rules").update(row).eq("id", id)
    : await supabase.from("safety_rules").insert({ ...row, code: str("code", 61) });
  if (error) {
    return { error: /duplicate key/.test(error.message) ? t("هذا الرمز مستخدم.", "This code is already used.")
      : /check constraint|row-level/.test(error.message) ? t("بيانات غير صالحة (الرمز: حروف إنجليزية صغيرة وأرقام و_)، أو ليست لديك صلاحية.", "Invalid data (code: lowercase letters, digits and _), or you do not have permission.")
      : explainError(error, t) };
  }
  revalidatePath("/admin/safety-rules");
  return { ok: true, message: t("حُفظت القاعدة. إن غيّرتَ نصها فقد عادت إلى «لم تُراجع».", "Rule saved. If you changed what it says, it is back to “not reviewed”.") };
}

/** The administrator has reviewed this version of the rule (the database records who and when). */
export async function reviewSafetyRule(fd: FormData) {
  const user = await requireUser();
  if ((await currentProfile())?.role !== "admin") return;
  const id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(id)) return;
  await createClient().from("safety_rules").update({ reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/safety-rules");
}
