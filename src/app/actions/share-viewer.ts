"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearShareSession, clientMeta, getShareSession, setShareSession, validToken } from "@/lib/share";
import { i18n } from "@/lib/i18n";
import type { FormState } from "@/components/ui/client";

/** The doctor's PIN gate. Every failure path returns a generic message; the database enforces limits. */
export async function openShare(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const token = String(fd.get("_t") ?? "");
  const pin = String(fd.get("pin") ?? "").replace(/\s/g, "");
  const generic = t("الرابط غير صالح، أو منتهي، أو ملغى.", "This link is invalid, expired or revoked.");
  if (!validToken(token)) return { error: generic };
  if (!/^\d{6}$/.test(pin)) return { error: t("أدخل رمز PIN المكوّن من 6 أرقام.", "Enter the 6-digit PIN.") };
  const { ipHash, ua } = clientMeta();
  const { data, error } = await createAdminClient().rpc("share_open", { p_token: token, p_pin: pin, p_ip_hash: ipHash, p_user_agent: ua });
  if (error || !data) return { error: t("تعذر التحقق الآن. حاول لاحقاً.", "Could not verify right now. Try again later.") };
  const r = data as { status: string; session_token?: string; expires_at?: string; attempts_left?: number; retry_after_seconds?: number };
  if (r.status === "ok" && r.session_token && r.expires_at) {
    setShareSession(token, r.session_token, Math.floor((Date.parse(r.expires_at) - Date.now()) / 1000));
    redirect(`/s/${token}/view`);
  }
  if (r.status === "invalid_pin") return { error: t(`الرمز غير صحيح. المحاولات المتبقية: ${r.attempts_left}`, `Incorrect PIN. Attempts left: ${r.attempts_left}`) };
  if (r.status === "locked") return { error: t(`تم قفل الرابط مؤقتاً. حاول بعد ${Math.ceil((r.retry_after_seconds ?? 900) / 60)} دقيقة.`, `This link is temporarily locked. Try again in ${Math.ceil((r.retry_after_seconds ?? 900) / 60)} minutes.`) };
  if (r.status === "throttled") return { error: t("محاولات كثيرة من هذا الجهاز. انتظر قليلاً.", "Too many attempts from this device. Please wait.") };
  return { error: generic };
}

export async function endShare(fd: FormData) {
  const token = String(fd.get("_t") ?? "");
  if (!validToken(token)) redirect("/");
  const session = getShareSession(token);
  if (session) {
    const { ipHash, ua } = clientMeta();
    await createAdminClient().rpc("share_end_session", { p_session_token: session, p_ip_hash: ipHash, p_user_agent: ua });
  }
  clearShareSession(token);
  redirect(`/s/${token}?ended=1`);
}

export async function addShareNote(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const token = String(fd.get("_t") ?? "");
  const session = validToken(token) ? getShareSession(token) : null;
  const name = String(fd.get("author_name") ?? "").trim(), body = String(fd.get("body") ?? "").trim();
  if (!session) return { error: t("انتهت الجلسة. أدخل الرمز من جديد.", "Session ended. Enter the PIN again.") };
  if (name.length < 2 || body.length < 1) return { error: t("أدخل اسمك والملاحظة.", "Enter your name and the note.") };
  if (body.length > 4000) return { error: t("الملاحظة طويلة جداً.", "The note is too long.") };
  const { ipHash, ua } = clientMeta();
  const { data } = await createAdminClient().rpc("share_add_note", { p_session_token: session, p_author_name: name.slice(0, 120), p_body: body, p_ip_hash: ipHash, p_user_agent: ua });
  const st = (data as { status?: string } | null)?.status;
  if (st === "ok") { revalidatePath(`/s/${token}/view`); return { ok: true, message: t("أُرسلت الملاحظة للمريض.", "Your note was sent to the patient.") }; }
  if (st === "limit") return { error: t("بلغت الحد الأقصى للملاحظات.", "Note limit reached.") };
  if (st === "forbidden") return { error: t("الملاحظات غير مسموحة في هذه المشاركة.", "Notes are not allowed on this share.") };
  return { error: t("انتهت الجلسة. أدخل الرمز من جديد.", "Session ended. Enter the PIN again.") };
}
