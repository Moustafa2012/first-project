"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, getTz, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { isPrecision, localDate, normalizePartialDate } from "@/lib/format";
import {
  ANXIETY, BRUSHING, DENTITION, EVIDENCE, FINDING_KIND, FINDING_SEVERITY, FLOSSING, MATERIAL, SURFACES, WHOLE_TOOTH_KINDS, isFdi, parseExamForm, parseTeeth,
  type Surface,
} from "@/lib/dental";
import type { Opt } from "@/lib/labels";
import type { FormState } from "@/components/ui/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const has = (list: Opt[], v: string) => list.some((x) => x.value === v);
const pathOf = (pid: string) => `/patients/${pid}/dental`;

/** A whole exam (tooth states + findings) in one transaction. */
export async function saveDentalExam(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? "");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const parsed = parseExamForm(fd, t, localDate(new Date(), getTz()));
  if ("error" in parsed) return { error: parsed.error };
  const supabase = createClient();
  if (fd.get("_dup_ok") !== "on") {
    const { data: same } = await supabase.from("dental_exams").select("id").eq("patient_id", pid).eq("exam_date", parsed.exam.exam_date)
      .eq("record_status", "active").limit(1);
    if (same?.length) {
      return {
        error: t("يوجد فحص أسنان مسجل في التاريخ نفسه. هل هو فحص آخر فعلاً؟", "A dental exam is already recorded on this date. Is this really another exam?"),
        confirm: { name: "_dup_ok", label: t("نعم، فحص مختلف — احفظه", "Yes, a different exam — save it") },
      };
    }
  }
  const { error } = await supabase.rpc("dental_exam_create", { p_patient: pid, p_exam: parsed.exam, p_states: parsed.states, p_findings: parsed.findings });
  if (error) return { error: explainError(error, t) };
  revalidatePath(pathOf(pid));
  return { ok: true, message: t("حُفظ الفحص.", "Exam saved.") };
}

/** One finding outside any exam, e.g. "I have had a crown on 46 since 2019". */
export async function addDentalFinding(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? "");
  const tooth = Number(fd.get("tooth"));
  const kind = String(fd.get("kind") ?? ""), evidence = String(fd.get("evidence") || "unknown");
  const severity = String(fd.get("severity") ?? ""), material = String(fd.get("material") ?? "");
  const date = String(fd.get("observed_on") ?? ""), prec = String(fd.get("date_precision") || "day");
  if (!UUID_RE.test(pid) || !isFdi(tooth)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!has(FINDING_KIND, kind)) return { error: t("اختر نوع الموجود.", "Choose what was found.") };
  if (!has(EVIDENCE, evidence) || (severity && !has(FINDING_SEVERITY, severity)) || (material && !has(MATERIAL, material)) || !isPrecision(prec)) {
    return { error: t("اختيار غير صالح.", "Invalid choice.") };
  }
  if (!DATE_RE.test(date)) return { error: t("أدخل التاريخ (ولو تقريبياً).", "Enter the date (an approximate one is fine).") };
  const surfaces = WHOLE_TOOTH_KINDS.has(kind) ? [] : fd.getAll("surfaces").map(String).filter((s): s is Surface => SURFACES.includes(s as Surface));
  const notes = String(fd.get("notes") ?? "").trim().slice(0, 2000);
  const { error } = await createClient().from("dental_findings").insert({
    patient_id: pid, tooth, kind, evidence, surfaces: [...new Set(surfaces)], severity: severity || null, material: material || null,
    observed_on: normalizePartialDate(date, prec), date_precision: prec, notes: notes || null,
    specialty_id: String(fd.get("_spec") ?? "") || null,
  });
  if (error) return { error: explainError(error, t) };
  revalidatePath(pathOf(pid));
  return { ok: true, message: t("أُضيف إلى السن.", "Added to the tooth.") };
}

/** "This caries was filled" / "this crown was replaced": the finding leaves the current chart but stays in the history. */
export async function resolveDentalFinding(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? ""), date = String(fd.get("resolved_on") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!DATE_RE.test(date)) return { error: t("أدخل التاريخ.", "Enter the date.") };
  const { data, error } = await createClient().from("dental_findings")
    .update({ resolved_on: date, resolved_note: String(fd.get("resolved_note") ?? "").trim().slice(0, 500) || null })
    .eq("id", id).eq("patient_id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على السجل.", "Record not found.") };
  revalidatePath(pathOf(pid));
  return { ok: true, message: t("سُجّل أنه عولج / انتهى.", "Recorded as treated / resolved.") };
}

export async function invalidateDental(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? ""), table = String(fd.get("_table") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || !["dental_exams", "dental_findings"].includes(table)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب سبب الإبطال.", "Enter a reason.") };
  const { data, error } = await createClient().from(table)
    .update({ record_status: "entered_in_error", invalidated_reason: reason.slice(0, 500) }).eq("id", id).eq("patient_id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على السجل.", "Record not found.") };
  revalidatePath(pathOf(pid));
  return { ok: true, message: t("أُبطل وبقي في التاريخ.", "Invalidated and kept in the history.") };
}

export async function saveDentalProfile(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? "");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const pick = (k: string, list: Opt[]) => { const v = String(fd.get(k) ?? ""); return v && has(list, v) ? v : null; };
  const yn = (k: string) => { const v = String(fd.get(k) ?? ""); return v === "yes" ? true : v === "no" ? false : null; };
  const date = (k: string) => { const v = String(fd.get(k) ?? ""); return DATE_RE.test(v) ? v : null; };
  const text = (k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max) || null;
  const row = {
    patient_id: pid, dentition: pick("dentition", DENTITION) ?? "permanent", brushing: pick("brushing", BRUSHING), flossing: pick("flossing", FLOSSING),
    bruxism: yn("bruxism"), dry_mouth: yn("dry_mouth"), dental_anxiety: pick("dental_anxiety", ANXIETY),
    orthodontic_history: text("orthodontic_history", 1000), last_visit_on: date("last_visit_on"), last_cleaning_on: date("last_cleaning_on"),
    notes: text("notes", 2000),
  };
  const { error } = await createClient().from("dental_profiles").upsert(row, { onConflict: "patient_id" });
  if (error) return { error: explainError(error, t) };
  revalidatePath(pathOf(pid));
  return { ok: true, message: t("حُفظ الملف السني.", "Dental profile saved.") };
}

/** Names the teeth of a dental problem recorded without them, so it appears on the chart. */
export async function setConditionTeeth(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const teeth = parseTeeth(String(fd.get("teeth") ?? ""));
  if (!teeth || teeth.length === 0) return { error: t("أرقام أسنان غير صالحة (FDI: 11–48، اللبنية 51–85).", "Invalid tooth numbers (FDI: 11–48, primary 51–85).") };
  const { data, error } = await createClient().from("conditions").update({ teeth }).eq("id", id).eq("patient_id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على السجل.", "Record not found.") };
  revalidatePath(pathOf(pid));
  return { ok: true, message: t("حُدد السن، وصار على المخطط.", "Tooth set; it is now on the chart.") };
}
