"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { siteUrl } from "@/lib/env";
import { UUID_RE } from "@/lib/data";
import { CONTRIB_MODULES, SHARE_MODULES } from "@/lib/labels";
import type { FormState } from "@/components/ui/client";

const ITEM_TABLES = ["encounters", "observations", "medical_documents", "procedures", "imaging_studies", "clinical_notes", "specialty_records", "conditions", "care_plans"];
const EXPIRY: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "3d": 3 * 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export async function createShare(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? "");
  const title = String(fd.get("title") ?? "").trim();
  const scope = String(fd.get("scope_kind") ?? "");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (title.length < 2) return { error: t("اكتب غرض المشاركة.", "Enter the purpose of the share.") };
  if (!["full", "specialty", "custom"].includes(scope)) return { error: t("اختر نطاق المشاركة.", "Choose the share scope.") };

  const specialties = fd.getAll("specialty").map(String).filter((x) => UUID_RE.test(x));
  const include = fd.getAll("include").map(String).filter((x) => SHARE_MODULES.some((m) => m.value === x));
  const obsTypes = fd.getAll("obs_type").map(String).filter((x) => UUID_RE.test(x));
  const items = fd.getAll("item").map(String).map((s) => s.split(":")).filter(([tb, id]) => ITEM_TABLES.includes(tb) && UUID_RE.test(id ?? "")).map(([table, id]) => ({ table, id }));
  const df = String(fd.get("date_from") ?? ""), dt = String(fd.get("date_to") ?? "");
  const ms = EXPIRY[String(fd.get("expiry") ?? "24h")] ?? EXPIRY["24h"];
  const expiresAt = new Date(Date.now() + ms).toISOString();
  const attempts = Math.min(10, Math.max(3, Number(fd.get("max_attempts") ?? 5) || 5));
  const allowContribute = fd.get("allow_contribute") === "on";
  const contribute = fd.getAll("contribute").map(String).filter((x) => CONTRIB_MODULES.some((m) => m.value === x));
  if (allowContribute && contribute.length === 0) return { error: t("اختر ما يمكن للطبيب إضافته.", "Choose what the doctor may add.") };
  const cl = (k: string, max: number) => String(fd.get(`clinician_${k}`) ?? "").trim().slice(0, max);
  const clinician = { name: cl("name", 120), specialty: cl("specialty", 120), facility: cl("facility", 200), city: cl("city", 120), license: cl("license", 60), phone: cl("phone", 40) };
  if (clinician.name.length < 3) return { error: t("اكتب اسم الطبيب الذي تذهب إليه.", "Enter the name of the doctor you are going to.") };
  if (clinician.specialty.length < 2) return { error: t("اكتب تخصص الطبيب.", "Enter the doctor's specialty.") };
  if (clinician.facility.length < 2) return { error: t("اكتب اسم العيادة أو المنشأة.", "Enter the clinic or facility.") };

  const { data, error } = await createClient().rpc("share_create", {
    p_patient: pid, p_title: title, p_scope_kind: scope, p_specialty_ids: scope === "specialty" ? specialties : [], p_include: include,
    p_observation_type_ids: obsTypes, p_date_from: /^\d{4}-\d{2}-\d{2}$/.test(df) ? df : null, p_date_to: /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : null,
    p_expires_at: expiresAt, p_max_attempts: attempts, p_allow_download: fd.get("allow_download") === "on", p_allow_print: fd.get("allow_print") === "on",
    p_allow_notes: fd.get("allow_notes") === "on", p_include_sensitive: fd.get("include_sensitive") === "on",
    p_recipient_label: [clinician.name, clinician.facility].filter(Boolean).join(" — ").slice(0, 200), p_items: scope === "custom" ? items : [],
    p_allow_contribute: allowContribute, p_contribute_modules: allowContribute ? contribute : [], p_clinician: clinician,
  });
  if (error) return { error: explainError(error, t) };
  const r = data as { share_id: string; token: string; pin: string; expires_at: string };
  const origin = process.env.NEXT_PUBLIC_SITE_URL ? siteUrl() : headers().get("origin") ?? siteUrl();
  revalidatePath(`/patients/${pid}/sharing`);
  revalidatePath("/shares");
  return { ok: true, data: { link: `${origin}/s/${r.token}`, pin: r.pin, expires: new Date(r.expires_at).toISOString().replace("T", " ").slice(0, 16) + " UTC", manageHref: `/patients/${pid}/sharing/${r.share_id}` } };
}

export async function revokeShare(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("share_revoke", { p_share: id, p_reason: String(fd.get("reason") ?? "").slice(0, 300) || null });
  if (error) return { error: explainError(error, t) };
  revalidatePath(`/patients/${pid}/sharing`, "layout");
  revalidatePath("/shares");
  return { ok: true, message: t("أُلغيت المشاركة فوراً.", "Share revoked immediately.") };
}

export async function markNoteReviewed(fd: FormData) {
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return;
  await createClient().rpc("share_mark_note_reviewed", { p_note: id });
  revalidatePath(`/patients/${pid}`, "layout");
}

/** The owner has looked at what a clinician added through a share. */
export async function markContributorReviewed(fd: FormData) {
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return;
  await createClient().rpc("share_mark_contributor_reviewed", { p_contributor: id });
  revalidatePath(`/patients/${pid}`, "layout");
}

/** Marks everything one clinician added as entered in error (kept in the history with the reason). */
export async function invalidateContributions(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? ""), reason = String(fd.get("reason") ?? "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب السبب.", "Enter a reason.") };
  const { data, error } = await createClient().rpc("share_invalidate_contributions", { p_contributor: id, p_reason: reason.slice(0, 500) });
  if (error) return { error: explainError(error, t) };
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t(`أُبطل ${data} سجلاً وبقيت في التاريخ.`, `${data} record(s) invalidated and kept in the history.`) };
}
