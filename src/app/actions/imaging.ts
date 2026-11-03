"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { parseShapes } from "@/lib/dental-imaging";
import type { FormState } from "@/components/ui/client";

/**
 * An annotation drawn on an image file: arrows, circles, rectangles and text with coordinates as fractions of the image.
 * It is kept apart from the file, which is never changed; the database checks the shapes again and that the file belongs
 * to the study.
 */
export async function addImagingAnnotation(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), imaging = String(fd.get("imaging_id") ?? ""), doc = String(fd.get("document_id") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(imaging) || !UUID_RE.test(doc)) return { error: t("طلب غير صالح.", "Invalid request.") };
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get("shapes") ?? "[]")); } catch { return { error: t("الرسم غير صالح.", "Invalid drawing.") }; }
  const parsed = parseShapes(raw);
  if ("error" in parsed) return { error: t("ارسم شكلاً واحداً على الأقل (حتى 50).", "Draw at least one shape (up to 50).") };
  const { error } = await createClient().from("imaging_annotations").insert({ patient_id: pid, imaging_id: imaging, document_id: doc, shapes: parsed.shapes });
  if (error) return { error: /annotation_limit/.test(error.message) ? t("بلغت الصورة الحد الأقصى من التعليقات.", "This image has reached its limit of annotations.") : explainError(error, t) };
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("حُفظ التعليق على الصورة (الصورة الأصلية لم تتغير).", "The annotation was saved (the original image is unchanged).") };
}

/** An annotation is never edited: it is invalidated with a reason and stays in the history. */
export async function invalidateImagingAnnotation(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? ""), reason = String(fd.get("reason") ?? "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب سبب الإبطال.", "Enter a reason.") };
  const { data, error } = await createClient().from("imaging_annotations")
    .update({ record_status: "entered_in_error", invalidated_reason: reason.slice(0, 500) }).eq("id", id).eq("patient_id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على السجل.", "Record not found.") };
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("أُبطل التعليق وبقي في التاريخ.", "The annotation was invalidated and kept in the history.") };
}
