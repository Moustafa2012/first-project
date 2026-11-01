"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainError, requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/data";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { BUCKET } from "@/lib/storage";
import { signaturePng } from "@/lib/share-contrib";
import { consentError, parseConsentForm } from "@/lib/consent";
import type { FormState } from "@/components/ui/client";

const str = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? "").trim().slice(0, max);
function done(pid: string) {
  revalidatePath(`/patients/${pid}/dental`);
  revalidatePath(`/patients/${pid}`, "layout");
}

/**
 * The patient (or guardian) signs with a finger or mouse on the screen. The drawing is stored as a PNG in the private
 * bucket under the patient's own folder; the consent keeps the text as it was signed and is never edited afterwards.
 */
export async function signConsent(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const parsed = parseConsentForm(fd, t);
  if ("error" in parsed) return { error: parsed.error };
  const png = signaturePng(String(fd.get("signature") ?? ""));
  if (!png) return { error: t("وقّع في المربع أولاً.", "Sign in the box first.") };
  if (fd.get("agree") !== "on") return { error: t("أكّد الإقرار قبل التوقيع.", "Confirm the statement before signing.") };
  // only someone who may write to the file stores a signature in its folder (the database checks again when the consent is saved)
  if (!(await getAccess(pid)).canWrite) return { error: t("ليست لديك صلاحية لهذه العملية.", "You do not have permission for this action.") };
  const spec = str(fd, "specialty_id", 40);
  const admin = createAdminClient();
  const path = `${pid}/signatures/${randomUUID()}.png`;
  const up = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: false, cacheControl: "0" });
  if (up.error) return { error: t("تعذر حفظ التوقيع. حاول مرة أخرى.", "Could not save the signature. Try again.") };
  const { error } = await createClient().rpc("consent_create", {
    p_patient: pid, p_consent: { ...parsed.consent, specialty_id: UUID_RE.test(spec) ? spec : null }, p_signature_path: path,
  });
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    return { error: consentError(error.message, t) ?? explainError(error, t) };
  }
  done(pid);
  return { ok: true, message: parsed.consent.supersedes ? t("وُقّعت النسخة الجديدة وحلّت محل السابقة.", "The new version was signed and replaces the earlier one.") : t("حُفظت الموافقة بتوقيعك.", "The consent was saved with your signature.") };
}

/** Withdraw a consent (it stays in the file, with who withdrew it, when and why). */
export async function withdrawConsent(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), reason = str(fd, "reason", 500);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب سبب السحب.", "Enter the reason for withdrawing.") };
  const { error } = await createClient().rpc("consent_withdraw", { p_consent: id, p_reason: reason });
  if (error) return { error: consentError(error.message, t) ?? explainError(error, t) };
  done(pid);
  return { ok: true, message: t("سُحبت الموافقة وبقيت في السجل مع السبب.", "The consent was withdrawn; it stays in the record with the reason.") };
}
