"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { RECALL_KIND, RECALL_STATUS } from "@/lib/labels";
import type { FormState } from "@/components/ui/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd: FormData, k: string, max = 1000) => String(fd.get(k) ?? "").trim().slice(0, max);
function done(pid: string) { revalidatePath(`/patients/${pid}/dental`); revalidatePath(`/patients/${pid}`, "layout"); }

export async function addRecall(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), kind = str(fd, "kind", 30), label = str(fd, "label", 120), due = str(fd, "due_on", 10);
  const months = Number(str(fd, "interval_months", 3));
  if (!UUID_RE.test(pid) || !RECALL_KIND.some((k) => k.value === kind)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!Number.isInteger(months) || months < 1 || months > 60) return { error: t("الفترة بين شهر و60 شهراً.", "The interval is between 1 and 60 months.") };
  if (!DATE_RE.test(due)) return { error: t("اختر تاريخ الاستحقاق.", "Choose the due date.") };
  if (kind === "other" && label.length < 2) return { error: t("اكتب اسم المتابعة.", "Name the recall.") };
  const supabase = createClient();
  const spec = str(fd, "_spec", 40);
  const { error } = await supabase.from("recalls").insert({ patient_id: pid, specialty_id: UUID_RE.test(spec) ? spec : null, kind, label: label || null,
    interval_months: months, due_on: due, notes: str(fd, "notes", 1000) || null });
  if (error) return { error: explainError(error, t) };
  done(pid);
  return { ok: true, message: t("أُضيف الفحص الدوري.", "The recall was added.") };
}

export async function recallDone(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), date = str(fd, "date", 10);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || (date && !DATE_RE.test(date))) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("recall_done", { p_recall: id, p_date: date || null });
  if (error) return { error: /date_in_future/.test(error.message) ? t("التاريخ في المستقبل.", "The date is in the future.") : explainError(error, t) };
  done(pid);
  return { ok: true, message: t("سُجّل، وحُدّد الموعد التالي.", "Recorded; the next one is set.") };
}

export async function setRecallStatus(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), status = str(fd, "status", 20);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || !RECALL_STATUS.some((s) => s.value === status)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().from("recalls").update({ status }).eq("id", id).eq("patient_id", pid);
  if (error) return { error: explainError(error, t) };
  done(pid);
  return { ok: true, message: t("تغيّرت الحالة.", "Status changed.") };
}
