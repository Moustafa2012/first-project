import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeTz } from "@/lib/format";
import type { T } from "@/lib/i18n";

export interface SessionUser { id: string; email: string | null }

/**
 * The signed-in user, read from the verified access token (signature checked locally against the project's public
 * signing keys; no network round trip). Row Level Security still re-checks the same token inside the database.
 * A revoked session therefore stays valid until its token expires (1 hour at most); sensitive actions (file deletion)
 * ask for the password again.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const { data } = await createClient().auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  return { id: c.sub, email: typeof c.email === "string" ? c.email : null };
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export interface ProfileRow {
  id: string; full_name: string; role: string; preferred_lang: string; date_of_birth: string | null; sex: string | null;
  blood_abo: string | null; blood_rh: string | null; phone: string | null; nationality: string | null; city: string | null;
  country: string | null; avatar_path: string | null; updated_at: string;
}

export const currentProfile = cache(async () => {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await createClient().from("profiles").select("id, full_name, role, preferred_lang, date_of_birth, sex, blood_abo, blood_rh, phone, nationality, city, country, avatar_path, updated_at").eq("id", user.id).maybeSingle();
  return data as ProfileRow | null;
});

export function getTz(): string {
  return safeTz(cookies().get("tz")?.value);
}

export function getTheme(): "light" | "dark" | null {
  const v = cookies().get("theme")?.value;
  return v === "dark" || v === "light" ? v : null;
}

/** Turns database / API errors into a short message the user can act on. Never echoes raw SQL details. */
export function explainError(e: unknown, t: T): string {
  const err = e as { code?: string; message?: string } | null;
  const m = String(err?.message ?? "");
  // server-side diagnostics only: code + message, never the row data that Postgres puts in `details`
  console.error("[db-error]", err?.code ?? "-", m.slice(0, 300));
  const rules: [RegExp, string, string][] = [
    [/possible_duplicate/, "يوجد ملف بنفس الاسم وتاريخ الميلاد في حسابك. أكّد أنه شخص مختلف للمتابعة.", "A file with the same name and birth date already exists in your account. Confirm it is a different person to continue."],
    [/specialty_not_applicable/, "هذا التخصص لا ينطبق على جنس المريض المسجَّل.", "This specialty does not apply to the sex recorded for this patient."],
    [/measurement_not_applicable/, "هذا القياس لا ينطبق على جنس المريض المسجَّل.", "This measurement does not apply to the sex recorded for this patient."],
    [/sex_change_conflict/, "لا يمكن تغيير الجنس: توجد سجلات نشطة في تخصص أو فحص لا ينطبق على الجنس الجديد. أبطِلها أولاً (سُجّلت بالخطأ).", "The sex cannot be changed: active records exist in a specialty or test that does not apply to the new sex. Mark them entered-in-error first."],
    [/confirmation_mismatch/, "الاسم المُدخل لا يطابق اسم الملف.", "The name you typed does not match the file name."],
    [/already_pending/, "الملف مجدول للحذف مسبقاً.", "This file is already scheduled for deletion."],
    [/invalid_date_of_birth/, "تاريخ ميلاد غير صالح.", "Invalid date of birth."],
    [/outside the plausible range/, "القيمة خارج النطاق المعقول. راجع الرقم والوحدة.", "The value is outside the plausible range. Check the number and unit."],
    [/systolic must be greater/, "الضغط الانقباضي يجب أن يكون أكبر من الانبساطي.", "Systolic must be greater than diastolic."],
    [/systolic and diastolic together/, "ضغط الدم يتطلب القيمتين معاً.", "Blood pressure needs both values."],
    [/unsupported unit/, "وحدة غير مدعومة لهذا القياس.", "Unsupported unit for this measurement."],
    [/cannot be in the future|in the future/, "لا يمكن أن يكون التاريخ في المستقبل.", "The date cannot be in the future."],
    [/cannot be edited|record a correction/, "النتيجة المعتمدة لا تُعدَّل في مكانها. استخدم «تصحيح».", "An approved result cannot be edited in place. Use “Correct”."],
    [/reason is required/, "السبب مطلوب.", "A reason is required."],
    [/cannot be modified/, "هذا السجل أُبطل ولا يمكن تعديله.", "This record was invalidated and can no longer be modified."],
    [/at least one result/, "أضف نتيجة واحدة على الأقل.", "Add at least one result."],
    [/row-level security|forbidden/i, "ليست لديك صلاحية لهذه العملية.", "You do not have permission for this action."],
    [/duplicate key/, "السجل موجود مسبقاً.", "This record already exists."],
    [/violates foreign key/, "ارتباط غير صالح بسجل آخر.", "Invalid link to another record."],
    [/check constraint|invalid input/, "بيانات غير صالحة. راجع الحقول.", "Invalid data. Please review the fields."],
    [/expiry must be between/, "مدة الصلاحية يجب أن تكون بين 5 دقائق و30 يوماً.", "Expiry must be between 5 minutes and 30 days."],
    [/at least one specialty/, "اختر تخصصاً واحداً على الأقل.", "Choose at least one specialty."],
    [/at least one selected/, "اختر سجلاً واحداً على الأقل.", "Select at least one record."],
  ];
  for (const [re, ar, en] of rules) if (re.test(m) || re.test(String(err?.code ?? ""))) return t(ar, en);
  return t("تعذر تنفيذ العملية. حاول مرة أخرى.", "The action could not be completed. Please try again.");
}
