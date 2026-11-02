"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/data";
import type { FormState } from "@/components/ui/client";

/** Ends one other sign-in of the account (the database only ever touches the caller's own sessions). */
export async function revokeSession(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { data, error } = await createClient().rpc("account_revoke_session", { p_session: id });
  if (error) {
    if (/cannot_revoke_current/.test(error.message)) return { error: t("هذه جلستك الحالية: استخدم «تسجيل الخروج».", "This is your current session: use “Sign out”.") };
    return { error: explainError(error, t) };
  }
  revalidatePath("/account");
  return { ok: true, message: data ? t("أُنهيت الجلسة.", "The session was signed out.") : t("الجلسة منتهية أصلاً.", "That session had already ended.") };
}

/** Signs out every device except this one (GoTrue's own scope "others"). */
export async function revokeOtherSessions(): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const supabase = createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { error: t("تعذر إنهاء الجلسات الأخرى. حاول مرة أخرى.", "Could not sign out the other sessions. Please try again.") };
  await supabase.rpc("account_record_event", { p_kind: "sessions_revoked", p_user_agent: (headers().get("user-agent") ?? "").slice(0, 300) });
  revalidatePath("/account");
  return { ok: true, message: t("أُنهيت كل الجلسات الأخرى.", "All other sessions were signed out.") };
}
