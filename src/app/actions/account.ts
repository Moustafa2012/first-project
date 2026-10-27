"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { ABO, RH, SEX } from "@/lib/labels";
import type { FormState } from "@/components/ui/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const oneOf = (v: string, list: { value: string }[]) => list.some((o) => o.value === v);

/** Saves the signed-in user's own basic profile (never their role: that column is not writable by users). */
export async function updateProfile(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const user = await requireUser();
  const name = str(fd, "full_name");
  const dob = str(fd, "date_of_birth");
  const sex = str(fd, "sex");
  const abo = str(fd, "blood_abo");
  const rh = str(fd, "blood_rh");
  const lang = str(fd, "preferred_lang") === "en" ? "en" : "ar";
  if (name.length < 2) return { error: t("أدخل اسمك الكامل.", "Enter your full name.") };
  if (dob && (!DATE_RE.test(dob) || Number.isNaN(Date.parse(dob)) || dob > new Date().toISOString().slice(0, 10) || dob < "1900-01-01")) {
    return { error: t("تاريخ ميلاد غير صالح.", "Invalid date of birth.") };
  }
  if ((sex && !oneOf(sex, SEX)) || (abo && !oneOf(abo, ABO)) || (rh && !oneOf(rh, RH))) return { error: t("بيانات غير صالحة.", "Invalid data.") };
  const { error } = await createClient().from("profiles").update({
    full_name: name, preferred_lang: lang, date_of_birth: dob || null, sex: sex || null, blood_abo: abo || null, blood_rh: rh || null,
    phone: str(fd, "phone", 40) || null, nationality: str(fd, "nationality", 80) || null, city: str(fd, "city", 100) || null, country: str(fd, "country", 100) || null,
  }).eq("id", user.id);
  if (error) return { error: explainError(error, t) };
  revalidatePath("/", "layout");
  return { ok: true, message: t("تم حفظ بيانات حسابك.", "Your account details were saved.") };
}
