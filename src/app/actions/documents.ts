"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/data";
import { SENSITIVITY } from "@/lib/labels";
import type { FormState } from "@/components/ui/client";

export async function invalidateDocument(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? ""), reason = String(fd.get("reason") ?? "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب السبب.", "Enter a reason.") };
  const { data, error } = await createClient().from("medical_documents").update({ record_status: "entered_in_error", invalidated_reason: reason.slice(0, 500) }).eq("id", id).eq("patient_id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على المستند.", "Document not found.") };
  revalidatePath(`/patients/${pid}/documents`);
  return { ok: true, message: t("أُبطل المستند وبقي في التاريخ.", "Document invalidated and kept in the history.") };
}

export async function setDocumentSensitivity(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? ""), s = String(fd.get("sensitivity") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || !SENSITIVITY.some((x) => x.value === s)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().from("medical_documents").update({ sensitivity: s }).eq("id", id).eq("patient_id", pid);
  if (error) return { error: explainError(error, t) };
  revalidatePath(`/patients/${pid}/documents`);
  return { ok: true, message: t("تم التحديث.", "Updated.") };
}
