"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { i18n } from "@/lib/i18n";
import { siteUrl } from "@/lib/env";
import type { FormState } from "@/components/ui/client";
import { isLocalPath } from "@/lib/safe-path";
import { authErrorMessage } from "@/lib/auth-errors";
import { passwordProblem } from "@/lib/password-rules";
import { afterSignIn } from "@/lib/after-sign-in";

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return isLocalPath(s) && !s.startsWith("/s/") ? s : "/patients";
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: t("أدخل البريد وكلمة المرور.", "Enter your email and password.") };
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: authErrorMessage(error, t, "login") };
  const after = await afterSignIn(supabase);
  if (after === "purged") return { error: t("حُذف هذا الحساب نهائياً ولا يمكن استعادته.", "This account was permanently deleted and cannot be restored.") };
  if (after === "restored") return { ok: true, redirectTo: "/account?restored=1" };
  return { ok: true, redirectTo: safeNext(fd.get("next")) };
}

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const name = String(fd.get("full_name") ?? "").trim();
  if (name.length < 2) return { error: t("أدخل اسمك.", "Enter your name.") };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: t("بريد إلكتروني غير صالح.", "Invalid email address.") };
  const weak = passwordProblem(password, t);
  if (weak) return { error: weak };
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name }, emailRedirectTo: `${siteUrl()}/auth/callback` },
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (!code || !["over_request_rate_limit", "over_email_send_rate_limit", "user_already_exists", "email_exists", "weak_password", "email_address_invalid", "validation_failed", "signup_disabled"].includes(code)) {
      console.error("[signup-error]", code ?? "-", error.status ?? "-", error.message.slice(0, 200));
    }
    return { error: authErrorMessage(error, t, "signup") };
  }
  if (!data.session) {
    return { ok: true, message: t("أرسلنا رسالة تأكيد إلى بريدك. افتحها ثم سجّل الدخول.", "We sent a confirmation email. Open it, then sign in.") };
  }
  await supabase.rpc("account_record_event", { p_kind: "sign_in", p_user_agent: (headers().get("user-agent") ?? "").slice(0, 300) });
  return { ok: true, redirectTo: safeNext(fd.get("next")) };
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
  const weak = passwordProblem(password, t);
  if (weak) return { error: weak };
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(error, t, "password") };
  // a changed password ends every other sign-in: whoever had the old one is out
  await supabase.auth.signOut({ scope: "others" });
  await supabase.rpc("account_record_event", { p_kind: "password_changed", p_user_agent: (headers().get("user-agent") ?? "").slice(0, 300) });
  return { ok: true, message: t("تم تحديث كلمة المرور وأُنهيت الجلسات الأخرى.", "Password updated. Your other sessions were signed out.") };
}

export async function logout() {
  await createClient().auth.signOut();
}

export async function currentOrigin(): Promise<string> {
  const h = headers();
  return h.get("origin") ?? siteUrl();
}
