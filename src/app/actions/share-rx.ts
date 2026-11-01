"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientMeta, getShareSession, validToken } from "@/lib/share";
import { i18n } from "@/lib/i18n";
import { explainError, getTz } from "@/lib/auth";
import { UUID_RE } from "@/lib/uuid";
import { localDate } from "@/lib/format";
import { BUCKET } from "@/lib/storage";
import { contribState, signaturePng } from "@/lib/share-contrib";
import { parseRxHeader, parseRxLines, rxError } from "@/lib/prescription";
import { consentError, parseConsentForm } from "@/lib/consent";
import type { FormState } from "@/components/ui/client";

/*
 * What the doctor does through the share link with prescriptions and consents. The database re-checks the session, the
 * modules the patient allowed, the scope and the limit on every call; the doctor is the one the patient named on the link.
 */

const ST: Record<string, [string, string]> = {
  expired: ["انتهت الجلسة أو أُلغيت المشاركة. أدخل الرمز من جديد.", "The session ended or the share was revoked. Enter the PIN again."],
  forbidden: ["هذا النوع من الإضافة غير مسموح في هذه المشاركة.", "This kind of addition is not allowed on this share."],
  identify_first: ["أكّد أنك الطبيب المذكور في الرابط أولاً.", "Confirm you are the doctor named on the link first."],
  limit: ["بلغت هذه المشاركة الحد الأقصى للإضافات.", "This share has reached its limit of additions."],
  invalid: ["بيانات غير صالحة.", "Invalid data."],
  not_found: ["لم يُعثر على السجل أو لا يخصّك.", "Record not found, or not yours."],
  reason_required: ["اكتب السبب.", "Enter the reason."],
};

function session(fd: FormData): { token: string; session: string } | null {
  const token = String(fd.get("_t") ?? "");
  const s = validToken(token) ? getShareSession(token) : null;
  return s ? { token, session: s } : null;
}
type T = (ar: string, en: string) => string;
function answer(data: unknown, error: { message: string } | null, t: T): FormState | null {
  if (error) return { error: rxError(error.message, t) ?? consentError(error.message, t) ?? explainError(error, t) };
  const r = (data ?? {}) as { status?: string; reason?: string };
  if (r.status === "ok") return null;
  if (r.status === "invalid" && r.reason) return { error: rxError(r.reason, t) ?? consentError(r.reason, t) ?? t(...ST.invalid) };
  return { error: t(...(ST[r.status ?? "invalid"] ?? ST.invalid)) };
}

/** The doctor writes a prescription: several medicines, dose, duration, quantity. The prescriber is the doctor named on the link. */
export async function contributePrescription(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const s = session(fd);
  if (!s) return { error: t(...ST.expired) };
  const st = await contribState(s.session);
  if (st.status !== "ok" || !st.contributor) return { error: t(...ST.identify_first) };
  fd.set("prescriber_name", st.contributor.full_name);        // shown to the patient; the database takes the name from the link, not from here
  const head = parseRxHeader(fd, t, localDate(new Date(), getTz()));
  if ("error" in head) return { error: head.error };
  const lines = parseRxLines(fd, t);
  if ("error" in lines) return { error: lines.error };
  const enc = String(fd.get("encounter_id") ?? "");
  const { ipHash, ua } = clientMeta();
  const { data, error } = await createAdminClient().rpc("share_prescription_create", {
    p_session_token: s.session, p_rx: { ...head.rx, encounter_id: UUID_RE.test(enc) ? enc : null }, p_lines: lines.lines, p_ip_hash: ipHash, p_user_agent: ua,
  });
  const bad = answer(data, error, t);
  if (bad) return bad;
  revalidatePath(`/s/${s.token}/view`);
  return { ok: true, message: t(`حُفظت الوصفة بـ ${lines.lines.length} دواء باسمك، ويراها المريض.`, `The prescription with ${lines.lines.length} medicine(s) was saved under your name; the patient sees it.`) };
}

/** The doctor withdraws a prescription they wrote through this share. */
export async function retractPrescription(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const s = session(fd);
  if (!s) return { error: t(...ST.expired) };
  const id = String(fd.get("_id") ?? ""), reason = String(fd.get("reason") ?? "").trim().slice(0, 400);
  if (!UUID_RE.test(id)) return { error: t(...ST.invalid) };
  const { ipHash, ua } = clientMeta();
  const { data, error } = await createAdminClient().rpc("share_retract_prescription", { p_session_token: s.session, p_id: id, p_reason: reason, p_ip_hash: ipHash, p_user_agent: ua });
  const bad = answer(data, error, t);
  if (bad) return bad;
  revalidatePath(`/s/${s.token}/view`);
  return { ok: true, message: t("سُحبت الوصفة وبقيت في التاريخ مع السبب.", "The prescription was withdrawn; it stays in the history with the reason.") };
}

/**
 * The doctor presents a consent and the patient signs it on the doctor's screen. The drawing is stored as a PNG in the
 * patient's own folder (never the doctor's); the consent carries the doctor as the presenter.
 */
export async function presentConsent(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const s = session(fd);
  if (!s) return { error: t(...ST.expired) };
  const parsed = parseConsentForm(fd, t);
  if ("error" in parsed) return { error: parsed.error };
  if (fd.get("agree") !== "on") return { error: t("أكّد الإقرار قبل التوقيع.", "Confirm the statement before signing.") };
  const png = signaturePng(String(fd.get("signature") ?? ""));
  if (!png) return { error: t("وقّع في المربع أولاً.", "Sign in the box first.") };
  const st = await contribState(s.session);
  if (st.status !== "ok" || !st.patient_id) return { error: t(...ST.expired) };
  if (!st.contributor) return { error: t(...ST.identify_first) };
  if (!(st.modules ?? []).includes("consents")) return { error: t(...ST.forbidden) };
  const admin = createAdminClient();
  const path = `${st.patient_id}/signatures/${randomUUID()}.png`;
  const up = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: false, cacheControl: "0" });
  if (up.error) return { error: t("تعذر حفظ التوقيع. حاول مرة أخرى.", "Could not save the signature. Try again.") };
  const { ipHash, ua } = clientMeta();
  const { data, error } = await admin.rpc("share_present_consent", { p_session_token: s.session, p_consent: parsed.consent, p_signature_path: path, p_ip_hash: ipHash, p_user_agent: ua });
  const bad = answer(data, error, t);
  if (bad) { await admin.storage.from(BUCKET).remove([path]); return bad; }
  revalidatePath(`/s/${s.token}/view`);
  return { ok: true, message: t("حُفظت الموافقة بتوقيع المريض، وتظهر في ملفه.", "The consent was saved with the patient's signature and appears in their file.") };
}
