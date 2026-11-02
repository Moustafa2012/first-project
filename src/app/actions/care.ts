"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { explainError, getTz, requireUser } from "@/lib/auth";
import { i18n, type T } from "@/lib/i18n";
import { siteUrl } from "@/lib/env";
import { UUID_RE } from "@/lib/uuid";
import { localDate } from "@/lib/format";
import { emergencyLink } from "@/lib/care/emergency";
import { INVITE_ACCESS, inviteLink, normalizeEmail, validEmail } from "@/lib/care/members";
import type { FormState } from "@/components/ui/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd: FormData, k: string, max = 1000) => String(fd.get(k) ?? "").trim().slice(0, max);
const origin = () => (process.env.NEXT_PUBLIC_SITE_URL ? siteUrl() : headers().get("origin") ?? siteUrl());
const refresh = (pid: string) => { revalidatePath(`/patients/${pid}`, "layout"); revalidatePath("/reminders"); revalidatePath("/patients"); };

/** The database's own words for the care functions, in the person's language; anything else goes through the common explainer. */
function careError(e: unknown, t: T): string {
  const m = String((e as { message?: string } | null)?.message ?? "");
  const rules: [RegExp, string, string][] = [
    [/already_enabled/, "بطاقة الطوارئ مفعّلة مسبقاً؛ جدّد الرابط بدلاً من ذلك.", "The emergency card is already on; regenerate the link instead."],
    [/not_enabled/, "بطاقة الطوارئ غير مفعّلة.", "The emergency card is not on."],
    [/invite_unavailable/, "الدعوة غير صالحة: منتهية أو مُلغاة أو سبق استخدامها.", "This invitation is not valid: it expired, was cancelled or was already used."],
    [/email_mismatch/, "الدعوة مكتوبة لبريد إلكتروني آخر. سجّل الدخول بالحساب المدعو.", "This invitation was written for another e-mail address. Sign in with the invited account."],
    [/already_member/, "هذا الحساب عضو في الملف بالفعل.", "This account is already a member of the file."],
    [/invalid_email/, "بريد إلكتروني غير صالح.", "Invalid e-mail address."],
    [/too_many_invites/, "عدد الدعوات المعلّقة كبير. ألغِ بعضها أولاً.", "Too many pending invitations. Cancel some first."],
    [/cannot_revoke_manager/, "لا يمكن إزالة المالك أو ولي الأمر.", "An owner or guardian cannot be removed."],
    [/date_in_future/, "التاريخ في المستقبل.", "The date is in the future."],
    [/not_found/, "لم يعد هذا السجل موجوداً.", "This record is no longer there."],
  ];
  for (const [re, ar, en] of rules) if (re.test(m)) return t(ar, en);
  return explainError(e, t);
}

// ---------------------------------------------------------------- reminders
export async function addReminder(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), title = str(fd, "title", 200), due = str(fd, "due_on", 10), notes = str(fd, "notes", 1000);
  const lead = Number(str(fd, "remind_days_before", 4) || "3");
  const repeatRaw = str(fd, "repeat_months", 3);
  const repeat = repeatRaw ? Number(repeatRaw) : null;
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (title.length < 2) return { error: t("اكتب نص التذكير.", "Write what to remind.") };
  if (!DATE_RE.test(due)) return { error: t("اختر تاريخ التذكير.", "Choose the reminder date.") };
  if (!Number.isInteger(lead) || lead < 0 || lead > 365) return { error: t("التنبيه المسبق بين 0 و365 يوماً.", "The lead time is between 0 and 365 days.") };
  if (repeat != null && (!Number.isInteger(repeat) || repeat < 1 || repeat > 60)) return { error: t("التكرار بين شهر و60 شهراً.", "The repeat is between 1 and 60 months.") };
  const { error } = await createClient().from("care_reminders").insert({ patient_id: pid, title, due_on: due, remind_days_before: lead, repeat_months: repeat, notes: notes || null });
  if (error) return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, message: t("أُضيف التذكير.", "The reminder was added.") };
}

export async function reminderDone(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("care_reminder_done", { p_reminder: id });
  if (error) return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, message: t("تم.", "Done.") };
}

export async function dismissReminder(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { data, error } = await createClient().from("care_reminders").update({ status: "dismissed", completed_on: localDate(new Date(), getTz()) })
    .eq("id", id).eq("patient_id", pid).eq("status", "open").select("id");
  if (error) return { error: careError(error, t) };
  if (!data?.length) return { error: t("لا تملك صلاحية التعديل.", "You may not edit this file.") };
  refresh(pid);
  return { ok: true, message: t("أُغلق التذكير.", "The reminder was closed.") };
}

/** A reminder written by mistake is invalidated with a reason and stays in the history, like any record. */
export async function invalidateReminder(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), reason = str(fd, "reason", 500);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب السبب.", "Enter a reason.") };
  const { data, error } = await createClient().from("care_reminders").update({ record_status: "entered_in_error", invalidated_reason: reason })
    .eq("id", id).eq("patient_id", pid).eq("record_status", "active").select("id");
  if (error) return { error: careError(error, t) };
  if (!data?.length) return { error: t("لا تملك صلاحية التعديل.", "You may not edit this file.") };
  refresh(pid);
  return { ok: true, message: t("أُبطل التذكير وبقي في السجل.", "The reminder was invalidated and stays in the history.") };
}

// ---------------------------------------------------------------- emergency card
/** Turns the link on (or makes a new one). The link and its token are returned once: only the token's hash is kept. */
export async function enableEmergency(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const supabase = createClient();
  const regenerate = fd.get("_regenerate") === "1";
  const { data, error } = regenerate
    ? await supabase.rpc("emergency_regenerate", { p_patient: pid })
    : await supabase.rpc("emergency_enable", { p_patient: pid, p_include_sensitive: fd.get("include_sensitive") === "on", p_include_contacts: fd.get("include_contacts") === "on" });
  if (error || typeof data !== "string") return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, data: { link: emergencyLink(origin(), data), token: data } };
}

export async function disableEmergency(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("emergency_disable", { p_patient: pid });
  if (error) return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, message: t("أُوقف الرابط فوراً.", "The link was switched off immediately.") };
}

export async function setEmergencyOptions(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("emergency_set_options", { p_patient: pid, p_include_sensitive: fd.get("include_sensitive") === "on", p_include_contacts: fd.get("include_contacts") === "on" });
  if (error) return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, message: t("حُفظ ما تعرضه البطاقة.", "What the card shows was saved.") };
}

// ---------------------------------------------------------------- members
/** Writes an invitation and returns its one-time link (shown once). Nothing is sent by e-mail. */
export async function inviteMember(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), email = normalizeEmail(str(fd, "email", 254)), access = str(fd, "access", 10);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!validEmail(email)) return { error: t("اكتب بريداً إلكترونياً صالحاً.", "Enter a valid e-mail address.") };
  if (!(INVITE_ACCESS as string[]).includes(access)) return { error: t("اختر المستوى: مشاهد أو محرّر.", "Choose the level: viewer or editor.") };
  const { data, error } = await createClient().rpc("member_invite_create", { p_patient: pid, p_email: email, p_access: access });
  if (error || typeof data !== "string") return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, data: { link: inviteLink(origin(), data), email } };
}

export async function revokeInvite(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("member_invite_revoke", { p_invite: id });
  if (error) return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, message: t("أُلغيت الدعوة.", "The invitation was cancelled.") };
}

export async function revokeMember(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), uid = str(fd, "_user", 40);
  if (!UUID_RE.test(pid) || !UUID_RE.test(uid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("member_revoke", { p_patient: pid, p_user: uid });
  if (error) return { error: careError(error, t) };
  refresh(pid);
  return { ok: true, message: t("انتهى وصوله إلى الملف فوراً.", "Their access to the file ended immediately.") };
}

/** A member leaves a file they were invited to. */
export async function leaveFile(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("member_leave", { p_patient: pid });
  if (error) return { error: careError(error, t) };
  revalidatePath("/patients");
  return { ok: true, redirectTo: "/patients" };
}

export async function acceptInvite(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const token = str(fd, "_t", 128);
  const { data, error } = await createClient().rpc("member_invite_accept", { p_token: token });
  if (error || typeof data !== "string") return { error: careError(error, t) };
  revalidatePath("/patients");
  return { ok: true, redirectTo: `/patients/${data}` };
}
