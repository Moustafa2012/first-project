"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { i18n } from "@/lib/i18n";
import { siteUrl } from "@/lib/env";
import type { FormState } from "@/components/ui/client";

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/s/") ? s : "/patients";
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: t("أدخل البريد وكلمة المرور.", "Enter your email and password.") };
  const { error } = await createClient().auth.signInWithPassword({ email, password });
  if (error) return { error: t("البريد أو كلمة المرور غير صحيحة.", "Incorrect email or password.") };
  return { ok: true, redirectTo: safeNext(fd.get("next")) };
}

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const name = String(fd.get("full_name") ?? "").trim();
  if (name.length < 2) return { error: t("أدخل اسمك.", "Enter your name.") };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: t("بريد إلكتروني غير صالح.", "Invalid email address.") };
  if (password.length < 10) return { error: t("كلمة المرور يجب ألا تقل عن 10 أحرف.", "Password must be at least 10 characters.") };
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name }, emailRedirectTo: `${siteUrl()}/auth/callback` },
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (error.status === 429 || code === "over_email_send_rate_limit") {
      return { error: t("تجاوز الخادم حد رسائل التأكيد المسموح بها. حاول بعد ساعة، أو اطلب من المسؤول ضبط خدمة بريد (SMTP) للمشروع.", "The confirmation-email limit was reached. Try again in an hour, or ask the administrator to configure SMTP for the project.") };
    }
    if (code === "user_already_exists") return { error: t("هذا البريد مسجل مسبقاً. سجّل الدخول.", "This email is already registered. Sign in instead.") };
    if (code === "weak_password") return { error: t("كلمة المرور ضعيفة. اختر كلمة أطول وأقوى.", "The password is too weak. Choose a longer, stronger one.") };
    if (code === "email_address_invalid" || code === "validation_failed") return { error: t("عنوان البريد غير مقبول.", "The email address was not accepted.") };
    console.error("[signup-error]", code ?? "-", error.status ?? "-", error.message.slice(0, 200));
    return { error: t("تعذر إنشاء الحساب. حاول لاحقاً.", "Could not create the account. Please try again later.") };
  }
  if (!data.session) {
    return { ok: true, message: t("أرسلنا رسالة تأكيد إلى بريدك. افتحها ثم سجّل الدخول.", "We sent a confirmation email. Open it, then sign in.") };
  }
  return { ok: true, redirectTo: "/patients" };
}

export async function requestReset(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const email = String(fd.get("email") ?? "").trim();
  if (/^\S+@\S+\.\S+$/.test(email)) {
    await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/auth/callback?next=/account` });
  }
  // same answer whether or not the address exists
  return { ok: true, message: t("إن كان البريد مسجلاً فستصله رسالة لإعادة التعيين.", "If that address is registered, a reset email is on its way.") };
}

export async function updatePassword(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const password = String(fd.get("password") ?? "");
  if (password.length < 10) return { error: t("كلمة المرور يجب ألا تقل عن 10 أحرف.", "Password must be at least 10 characters.") };
  const { error } = await createClient().auth.updateUser({ password });
  if (error) return { error: t("تعذر تحديث كلمة المرور.", "Could not update the password.") };
  return { ok: true, message: t("تم تحديث كلمة المرور.", "Password updated.") };
}

export async function logout() {
  await createClient().auth.signOut();
}

export async function currentOrigin(): Promise<string> {
  const h = headers();
  return h.get("origin") ?? siteUrl();
}
