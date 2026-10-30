"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearShareSession, clientMeta, getShareSession, setShareSession, validToken } from "@/lib/share";
import { i18n } from "@/lib/i18n";
import type { FormState } from "@/components/ui/client";
import { randomUUID } from "node:crypto";
import { BUCKET } from "@/lib/storage";
import { contribState, signaturePng } from "@/lib/share-contrib";
import { ENTITIES } from "@/lib/entities";
import { parseEntityForm } from "@/lib/entity-form";
import { CONTRIB_ENTITY } from "@/lib/labels";
import { explainError } from "@/lib/auth";
import { UUID_RE } from "@/lib/uuid";

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
    return { ok: true, redirectTo: `/s/${token}/view` };
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

const field = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);

/** The clinician states who they are and signs on screen; required once per session before adding anything. */
export async function identifyContributor(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const token = String(fd.get("_t") ?? "");
  const session = validToken(token) ? getShareSession(token) : null;
  if (!session) return { error: t("انتهت الجلسة. أدخل الرمز من جديد.", "Session ended. Enter the PIN again.") };
  const name = field(fd, "full_name", 120);
  if (name.length < 3) return { error: t("اكتب اسمك الكامل.", "Enter your full name.") };
  if (fd.get("attest") !== "on") return { error: t("أكّد الإقرار قبل المتابعة.", "Confirm the statement to continue.") };
  const png = signaturePng(String(fd.get("signature") ?? ""));
  if (!png) return { error: t("وقّع في المربع أولاً.", "Sign in the box first.") };
  const st = await contribState(session);
  if (st.status !== "ok" || !st.patient_id) return { error: t("الإضافة غير مسموحة في هذه المشاركة أو انتهت الجلسة.", "Adding is not allowed on this share, or the session ended.") };
  if (st.contributor) return { ok: true };

  const admin = createAdminClient();
  const path = `${st.patient_id}/signatures/${randomUUID()}.png`;
  const up = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: false, cacheControl: "0" });
  if (up.error) return { error: t("تعذر حفظ التوقيع. حاول مرة أخرى.", "Could not save the signature. Try again.") };
  const { ipHash, ua } = clientMeta();
  const { data, error } = await admin.rpc("share_identify", {
    p_session_token: session, p_full_name: name, p_specialty: field(fd, "specialty", 120), p_license_no: field(fd, "license_no", 60),
    p_facility: field(fd, "facility", 200), p_phone: field(fd, "phone", 40), p_signature_path: path, p_ip_hash: ipHash, p_user_agent: ua,
  });
  const status = (data as { status?: string } | null)?.status;
  if (error || status !== "ok") {
    await admin.storage.from(BUCKET).remove([path]);
    return { error: error ? explainError(error, t) : t("الإضافة غير مسموحة في هذه المشاركة.", "Adding is not allowed on this share.") };
  }
  revalidatePath(`/s/${token}/view`);
  return { ok: true, message: t("تم. يمكنك الآن الإضافة إلى الملف.", "Done. You can now add to the file.") };
}

const CONTRIB_STATUS: Record<string, [string, string]> = {
  expired: ["انتهت الجلسة أو أُلغيت المشاركة. أدخل الرمز من جديد.", "The session ended or the share was revoked. Enter the PIN again."],
  forbidden: ["هذا النوع من الإضافة غير مسموح في هذه المشاركة.", "This kind of addition is not allowed on this share."],
  identify_first: ["عرّف بنفسك ووقّع أولاً.", "Identify yourself and sign first."],
  limit: ["بلغت هذه المشاركة الحد الأقصى للإضافات.", "This share has reached its limit of additions."],
  invalid: ["بيانات غير صالحة.", "Invalid data."], not_found: ["لم يُعثر على السجل أو سبق سحبه.", "Record not found or already withdrawn."],
  reason_required: ["اكتب سبب السحب.", "Enter the reason for withdrawing."],
};

/** Adds one record (visit, diagnosis, procedure, note, medication, appointment, test request, imaging study). */
export async function contributeRecord(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const token = String(fd.get("_t") ?? "");
  const session = validToken(token) ? getShareSession(token) : null;
  if (!session) return { error: t(...CONTRIB_STATUS.expired) };
  const table = String(fd.get("_table") ?? "");
  const def = ENTITIES[CONTRIB_ENTITY[table] ?? ""];
  if (!def) return { error: t(...CONTRIB_STATUS.invalid) };
  const parsed = parseEntityForm(def, fd, t);
  if ("error" in parsed) return { error: parsed.error };
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.row)) if (v !== null && !["source", "source_detail", "specialty_id"].includes(k)) payload[k] = v;
  const enc = String(fd.get("_encounter") ?? "");
  if (enc) { if (!UUID_RE.test(enc)) return { error: t(...CONTRIB_STATUS.invalid) }; payload.encounter_id = enc; }
  const who = String(fd.get("_who") ?? "").slice(0, 120);
  if (who) {
    if (table === "clinical_notes" && !payload.author_name) payload.author_name = who;
    if (table === "test_orders" && !payload.ordered_by) payload.ordered_by = who;
    if (table === "medications" && !payload.prescriber_name) payload.prescriber_name = who;
    if (table === "procedures" && !payload.operator_name) payload.operator_name = who;
    if (table === "encounters" && !payload.practitioner_name) payload.practitioner_name = who;
  }
  const { ipHash, ua } = clientMeta();
  const { data, error } = await createAdminClient().rpc("share_contribute", { p_session_token: session, p_table: table, p_payload: payload, p_ip_hash: ipHash, p_user_agent: ua });
  if (error) return { error: explainError(error, t) };
  const st = (data as { status?: string } | null)?.status ?? "invalid";
  if (st !== "ok") return { error: t(...(CONTRIB_STATUS[st] ?? CONTRIB_STATUS.invalid)) };
  revalidatePath(`/s/${token}/view`);
  return { ok: true, message: t("أُضيف إلى ملف المريض باسمك.", "Added to the patient's file under your name.") };
}

/** The clinician withdraws something added through this share; it stays in the history with the reason. */
export async function retractContribution(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const token = String(fd.get("_t") ?? "");
  const session = validToken(token) ? getShareSession(token) : null;
  if (!session) return { error: t(...CONTRIB_STATUS.expired) };
  const id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(id)) return { error: t(...CONTRIB_STATUS.invalid) };
  const { ipHash, ua } = clientMeta();
  const { data, error } = await createAdminClient().rpc("share_retract", {
    p_session_token: session, p_table: String(fd.get("_table") ?? ""), p_id: id, p_reason: field(fd, "reason", 400), p_ip_hash: ipHash, p_user_agent: ua,
  });
  if (error) return { error: explainError(error, t) };
  const st = (data as { status?: string } | null)?.status ?? "invalid";
  if (st !== "ok") return { error: t(...(CONTRIB_STATUS[st] ?? CONTRIB_STATUS.invalid)) };
  revalidatePath(`/s/${token}/view`);
  return { ok: true, message: t("سُحب السجل وبقي في التاريخ مع السبب.", "Withdrawn; it stays in the history with the reason.") };
}
