"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, getTz, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { localDate } from "@/lib/format";
import { parseRxHeader, parseRxLines, rxError, RX_STATUS } from "@/lib/prescription";
import type { FormState } from "@/components/ui/client";

const str = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? "").trim().slice(0, max);
function done(pid: string) {
  revalidatePath(`/patients/${pid}/dental`);
  revalidatePath(`/patients/${pid}/medications`);
  revalidatePath(`/patients/${pid}`, "layout");
}

/** A prescription with its medicines, written in one call (the database writes the medication lines). */
export async function createPrescription(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const head = parseRxHeader(fd, t, localDate(new Date(), getTz()));
  if ("error" in head) return { error: head.error };
  const lines = parseRxLines(fd, t);
  if ("error" in lines) return { error: lines.error };
  const spec = str(fd, "specialty_id", 40), enc = str(fd, "encounter_id", 40);
  if ((spec && !UUID_RE.test(spec)) || (enc && !UUID_RE.test(enc))) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("prescription_create", {
    p_patient: pid, p_rx: { ...head.rx, specialty_id: spec || null, encounter_id: enc || null }, p_lines: lines.lines,
  });
  if (error) return { error: rxError(error.message, t) ?? explainError(error, t) };
  done(pid);
  return { ok: true, message: t(`حُفظت الوصفة بـ ${lines.lines.length} دواء، وأُضيفت الأدوية إلى الملف.`, `The prescription was saved with ${lines.lines.length} medicine(s); they were added to the file.`) };
}

/** Complete the course, or cancel with a reason; the medication lines follow. */
export async function setPrescriptionStatus(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), status = str(fd, "status", 20), reason = str(fd, "reason", 500);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || !RX_STATUS.some((s) => s.value === status) || status === "active") return { error: t("طلب غير صالح.", "Invalid request.") };
  if (status === "cancelled" && reason.length < 3) return { error: t("اكتب سبب الإلغاء.", "Give the reason for cancelling.") };
  const { error } = await createClient().rpc("prescription_set_status", { p_rx: id, p_status: status, p_reason: reason || null });
  if (error) return { error: rxError(error.message, t) ?? explainError(error, t) };
  done(pid);
  return { ok: true, message: status === "completed" ? t("اكتملت الوصفة وأُنهيت أدويتها.", "The prescription is complete and its medicines were ended.") : t("أُلغيت الوصفة وأُوقفت أدويتها.", "The prescription was cancelled and its medicines stopped.") };
}

/** A prescription entered by mistake: invalidated with a reason (its medicines go with it), kept in the history. */
export async function invalidatePrescription(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), reason = str(fd, "reason", 500);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب السبب.", "Give the reason.") };
  const { error } = await createClient().from("prescriptions").update({ record_status: "entered_in_error", invalidated_reason: reason }).eq("id", id).eq("patient_id", pid);
  if (error) return { error: explainError(error, t) };
  done(pid);
  return { ok: true, message: t("أُبطلت الوصفة مع السبب، وتبقى في السجل.", "The prescription was invalidated with the reason; it stays in the history.") };
}
