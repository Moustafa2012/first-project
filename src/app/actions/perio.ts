"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, getTz, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { localDate } from "@/lib/format";
import { SOURCE } from "@/lib/labels";
import { parsePerioTeeth, type PerioTooth } from "@/lib/perio";
import { buildPerioPlan } from "@/lib/perio-plan";
import { dxErrorText, parseDx } from "@/lib/perio-staging";
import type { FormState } from "@/components/ui/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pathOf = (pid: string) => `/patients/${pid}/dental`;

/** Saves the periodontal chart as a draft (creating it or updating the open one), and finalises it when asked. */
export async function savePerio(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? "");
  let id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(pid) || (id && !UUID_RE.test(id))) return { error: t("طلب غير صالح.", "Invalid request.") };
  const finalize = fd.get("_finalize") === "1";
  const date = String(fd.get("exam_date") ?? "");
  if (!DATE_RE.test(date)) return { error: t("أدخل تاريخ الفحص.", "Enter the exam date.") };
  if (date > localDate(new Date(), getTz())) return { error: t("تاريخ الفحص في المستقبل.", "The exam date is in the future.") };
  const parsed = parsePerioTeeth(String(fd.get("teeth") ?? "[]"));
  if ("error" in parsed) {
    return { error: parsed.error === "range"
      ? t("قيمة خارج النطاق: العمق 0–20 مم، حافة اللثة من −15 إلى +15 مم، الحركة 0–3، انقسام الجذور 0–3.",
          "A value is out of range: depth 0–20 mm, margin −15 to +15 mm, mobility 0–3, furcation 0–3.")
      : t("بيانات المخطط غير صالحة.", "The chart data is invalid.") };
  }
  // every tooth the chart sends is written, empty ones too: that is how a cleared tooth (or an unticked "missing") is saved
  const teeth = parsed.teeth;
  const dx = parseDx((k) => String(fd.get(k) ?? ""), finalize);
  if ("error" in dx) return { error: dxErrorText(dx.error, t) ?? t("بيانات التشخيص غير صالحة.", "The diagnosis is invalid.") };
  const enc = String(fd.get("encounter_id") ?? "");
  if (enc && !UUID_RE.test(enc)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (finalize && !teeth.some((x) => x.missing || x.pd)) {
    return { error: t("لا يُعتمد مخطط فارغ: سجّل أعماق الجيوب أولاً.", "An empty chart is not finalised: record the pocket depths first.") };
  }
  const source = String(fd.get("source") || "self");
  const exam = {
    exam_date: date, examiner_name: String(fd.get("examiner_name") ?? "").slice(0, 200), facility_name: String(fd.get("facility_name") ?? "").slice(0, 200),
    notes: String(fd.get("notes") ?? "").slice(0, 4000), source: SOURCE.some((s) => s.value === source) ? source : "self",
    encounter_id: enc || null, ...dx.dx,
  };
  const supabase = createClient();
  if (!id) {
    // a draft opened in another tab: continue it instead of failing on "one draft per file"
    const { data } = await supabase.from("perio_exams").select("id").eq("patient_id", pid).eq("status", "draft").eq("record_status", "active").is("contributed_by", null).limit(1);
    id = data?.[0]?.id ?? "";
  }
  const { data: saved, error } = await supabase.rpc("perio_exam_save", {
    p_patient: pid, p_exam_id: id || null, p_exam: exam, p_teeth: teeth, p_finalize: finalize,
  });
  if (error) {
    if (/perio_final/.test(error.message)) return { error: t("هذا المخطط معتمد ولا يُعدَّل.", "This chart is final and cannot be edited.") };
    if (/exam_empty/.test(error.message)) return { error: t("لا يُعتمد مخطط فارغ.", "An empty chart is not finalised.") };
    return { error: dxErrorText(error.message, t) ?? explainError(error, t) };
  }
  revalidatePath(pathOf(pid));
  const newId = String(saved ?? id);
  return {
    ok: true, data: { id: newId }, redirectTo: finalize ? `${pathOf(pid)}?tab=perio&pv=${newId}#perio` : undefined,
    message: finalize ? t("اعتُمد مخطط اللثة.", "The periodontal chart was finalised.") : t("حُفظت المسودة.", "Draft saved."),
  };
}

/** Discards a draft, or marks a final chart entered in error; either way it stays in the history with the reason. */
export async function invalidatePerio(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? "");
  const discard = fd.get("_discard") === "1";
  const reason = discard ? t("مسودة أُلغيت", "Draft discarded") : String(fd.get("reason") ?? "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب سبب الإبطال.", "Enter a reason.") };
  let q = createClient().from("perio_exams").update({ record_status: "entered_in_error", invalidated_reason: reason.slice(0, 500) })
    .eq("id", id).eq("patient_id", pid).eq("record_status", "active");
  if (discard) q = q.eq("status", "draft");
  const { data, error } = await q.select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على السجل.", "Record not found.") };
  revalidatePath(pathOf(pid));
  return { ok: true, message: discard ? t("أُلغيت المسودة.", "Draft discarded.") : t("أُبطل وبقي في التاريخ.", "Invalidated and kept in the history.") };
}

/** A phased periodontal plan from a final chart (initial therapy, re-evaluation, optional surgery, maintenance). */
export async function createPerioPlan(_: FormState, fd: FormData): Promise<FormState> {
  const { t, lang } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const supabase = createClient();
  const [{ data: exam }, { data: teeth }] = await Promise.all([
    supabase.from("perio_exams").select("*").eq("id", id).eq("patient_id", pid).eq("status", "final").eq("record_status", "active").maybeSingle(),
    supabase.from("perio_teeth").select("*").eq("exam_id", id).eq("patient_id", pid),
  ]);
  if (!exam) return { error: t("لم يُعثر على المخطط المعتمد.", "The final chart was not found.") };
  const plan = buildPerioPlan({ examDate: exam.exam_date as string, teeth: (teeth ?? []) as PerioTooth[], dx: exam, lang });
  const { error } = await supabase.rpc("treatment_plan_create", { p_patient: pid, p_plan: { title: plan.title, lang, notes: plan.notes }, p_items: plan.items });
  if (error) return { error: explainError(error, t) };
  revalidatePath(pathOf(pid));
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("أُنشئت خطة اللثة بمراحلها؛ تجدها في تبويب العلاج.", "The phased gum plan was created; find it in the Treatment tab."),
    redirectTo: `${pathOf(pid)}?tab=treatment` };
}
