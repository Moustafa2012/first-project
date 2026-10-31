"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import type { FormState } from "@/components/ui/client";

const str = (fd: FormData, k: string, max = 20000) => String(fd.get(k) ?? "").trim().slice(0, max);
const safePath = (pid: string, p: string) => (p.startsWith(`/patients/${pid}`) ? p : `/patients/${pid}`);
type T = (a: string, e: string) => string;
function noteError(e: { message: string }, t: T): string {
  if (/note_signed/.test(e.message)) return t("الملاحظة موقّعة: لا يُعدَّل نصها؛ أضف تعديلاً موثّقاً مع السبب.", "The note is signed: its text is not edited; add an amendment with the reason.");
  if (/note_not_signed/.test(e.message)) return t("المسودة تُعدَّل مباشرة.", "A draft is edited directly.");
  if (/contributed_record_readonly/.test(e.message)) return t("ملاحظة الطبيب يعدّلها هو فقط.", "Only the doctor who wrote it can amend it.");
  return explainError(e, t);
}

/** Sign a draft: its text is fixed from now on; who and when are recorded by the database. */
export async function signNote(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().from("clinical_notes").update({ status: "signed" }).eq("id", id).eq("patient_id", pid).eq("status", "draft");
  if (error) return { error: noteError(error, t) };
  revalidatePath(safePath(pid, str(fd, "_path", 300)));
  return { ok: true, message: t("وُقّعت الملاحظة. أي تغيير لاحق يُسجَّل تعديلاً موثّقاً.", "The note is signed. Any later change is recorded as an amendment.") };
}

/** A documented amendment to a signed note: added next to the original, with its reason. */
export async function amendNote(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), body = str(fd, "body"), reason = str(fd, "reason", 500);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!body) return { error: t("اكتب نص التعديل.", "Write the amendment.") };
  if (reason.length < 3) return { error: t("اكتب سبب التعديل.", "Give the reason for the amendment.") };
  const { error } = await createClient().from("note_amendments").insert({ patient_id: pid, note_id: id, body, reason });
  if (error) return { error: noteError(error, t) };
  revalidatePath(safePath(pid, str(fd, "_path", 300)));
  return { ok: true, message: t("أُضيف التعديل الموثّق؛ النص الأصلي محفوظ.", "The amendment was added; the original text is kept.") };
}

/** One's own note templates (the shared ones are managed by an administrator). */
export async function saveTemplate(_: FormState, fd: FormData): Promise<FormState> {
  const { t, lang } = i18n();
  const user = await requireUser();
  const id = str(fd, "_id", 40), title = str(fd, "title", 120), body = str(fd, "body", 8000);
  if (title.length < 2 || !body) return { error: t("اكتب عنوان القالب ونصه.", "Give the template a title and a text.") };
  const row = { title, body, lang, kind: ["progress", "consult", "nursing", "patient_note", "other"].includes(str(fd, "kind", 20)) ? str(fd, "kind", 20) : "progress" };
  const supabase = createClient();
  const { error } = id && UUID_RE.test(id)
    ? await supabase.from("note_templates").update(row).eq("id", id).eq("owner_id", user.id)
    : await supabase.from("note_templates").insert({ ...row, owner_id: user.id });
  if (error) return { error: explainError(error, t) };
  revalidatePath("/account");
  return { ok: true, message: t("حُفظ القالب.", "Template saved.") };
}

export async function deleteTemplate(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const user = await requireUser();
  const id = str(fd, "_id", 40);
  if (!UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().from("note_templates").delete().eq("id", id).eq("owner_id", user.id);
  if (error) return { error: explainError(error, t) };
  revalidatePath("/account");
  return { ok: true, message: t("حُذف القالب.", "Template deleted.") };
}
