"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { parseLocaleNumber } from "@/lib/clinical/number";
import { UUID_RE } from "@/lib/data";
import { LAB_FLAG, SETTING, SOURCE } from "@/lib/labels";
import { normText, sameMinute, sameNumber, within } from "@/lib/dedupe";
import { getTz } from "@/lib/auth";
import type { ObservationType } from "@/lib/types";
import type { FormState } from "@/components/ui/client";

const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);
const iso = (v: string) => { const d = new Date(v); return Number.isNaN(+d) ? null : d.toISOString(); };
const dupConfirm = (t: (ar: string, en: string) => string) => ({ name: "_dup_ok", label: t("ليس تكراراً، احفظ رغم ذلك", "It is not a duplicate — save anyway") });

/** Calendar date of an instant in the viewer's time zone (YYYY-MM-DD). */
function localDate(isoValue: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: getTz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoValue));
  } catch { return isoValue.slice(0, 10); }
}

async function typeOf(id: string): Promise<ObservationType | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await createClient().from("observation_types").select("*").eq("id", id).eq("is_active", true).maybeSingle();
  return (data as ObservationType | null) ?? null;
}

/** A single vital sign / home measurement (optionally with a pulse taken together with blood pressure). */
export async function addVital(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid");
  const type = await typeOf(str(fd, "type_id"));
  if (!UUID_RE.test(pid) || !type || type.category === "lab") return { error: t("طلب غير صالح.", "Invalid request.") };

  const when = iso(str(fd, "effective_at"));
  if (!when) return { error: t("حدّد وقت القياس.", "Enter the time of the measurement.") };
  const v1 = parseLocaleNumber(str(fd, "value_num"));
  const v2 = parseLocaleNumber(str(fd, "value_num2"));
  if (v1 == null) return { error: t("أدخل قيمة رقمية صحيحة.", "Enter a valid number.") };
  if (type.value_kind === "bp" && v2 == null) return { error: t("أدخل الضغط الانقباضي والانبساطي معاً.", "Enter both systolic and diastolic pressure.") };

  const setting = str(fd, "setting") || "home";
  const source = str(fd, "source") || "self";
  if (!SETTING.some((s) => s.value === setting) || !SOURCE.some((s) => s.value === source)) return { error: t("بيانات غير صالحة.", "Invalid data.") };
  const encounter = str(fd, "encounter_id");
  const base = {
    patient_id: pid, effective_at: when, setting, source,
    device: str(fd, "device", 200) || null, context: str(fd, "context", 60) || null,
    symptoms: str(fd, "symptoms") || null, notes: str(fd, "notes") || null,
    encounter_id: UUID_RE.test(encounter) ? encounter : null,
    source_detail: str(fd, "source_detail", 300) || null,
  };
  const rows: Record<string, unknown>[] = [{
    ...base, type_id: type.id, value_num: v1, value_num2: type.value_kind === "bp" ? v2 : null,
    unit: str(fd, "unit", 30) || null, custom_name: type.code === "other_measurement" ? str(fd, "custom_name", 120) || null : null,
  }];
  const pulse = parseLocaleNumber(str(fd, "pulse"));
  if (type.value_kind === "bp" && pulse != null) {
    const { data: hr } = await createClient().from("observation_types").select("id").eq("code", "heart_rate").maybeSingle();
    if (hr) rows.push({ ...base, type_id: hr.id, value_num: pulse, value_num2: null, unit: "bpm", context: base.context === "after_exercise" ? "after_exercise" : "resting" });
  }
  if (fd.get("_dup_ok") !== "on") {
    const from = new Date(Date.parse(when) - 60_000).toISOString(), to = new Date(Date.parse(when) + 60_000).toISOString();
    const { data: near } = await createClient().from("observations").select("value_num, value_num2, effective_at")
      .eq("patient_id", pid).eq("type_id", type.id).in("status", ["final", "preliminary"]).gte("effective_at", from).lte("effective_at", to);
    if ((near ?? []).some((o) => sameMinute(o.effective_at as string, when) && sameNumber(o.value_num as number, v1) && sameNumber(o.value_num2 as number | null, rows[0].value_num2 as number | null))) {
      return { error: t("هذه القراءة مسجلة من قبل بالقيمة والوقت نفسيهما.", "This reading is already recorded with the same value and time."), confirm: dupConfirm(t) };
    }
  }
  const { error } = await createClient().from("observations").insert(rows);
  if (error) return { error: explainError(error, t) };
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("تم تسجيل القراءة.", "Reading saved.") };
}

/** A lab report with all of its results, created atomically by the database function. */
export async function addLabReport(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid");
  const title = str(fd, "title", 200);
  if (!UUID_RE.test(pid) || title.length < 2) return { error: t("أدخل عنوان التقرير.", "Enter a report title.") };
  const collected = iso(str(fd, "collected_at"));
  if (!collected) return { error: t("أدخل تاريخ أخذ العينة.", "Enter the sample collection time.") };

  const keys = Array.from(new Set(Array.from(fd.keys()).map((k) => /^r(\d+)_type$/.exec(k)?.[1]).filter(Boolean) as string[]));
  const { lang } = i18n();
  const supabase = createClient();
  const { data: types } = await supabase.from("observation_types").select("id, code, value_kind, category, name_ar, name_en").eq("category", "lab").eq("is_active", true);
  const kindOf = new Map((types ?? []).map((x) => [x.id as string, x.value_kind as string]));
  const nameOf = new Map((types ?? []).map((x) => [x.id as string, (lang === "ar" ? x.name_ar : x.name_en) as string]));
  const isOther = new Set((types ?? []).filter((x) => String(x.code).startsWith("other_")).map((x) => x.id as string));
  const results: Record<string, unknown>[] = [];
  for (const k of keys) {
    const typeId = str(fd, `r${k}_type`);
    const raw = str(fd, `r${k}_value`);
    if (!typeId && !raw) continue;                                   // untouched blank row
    const kind = kindOf.get(typeId);
    if (!kind) return { error: t("اختر نوع التحليل لكل صف.", "Choose the test for every row.") };
    if (!raw) return { error: t("أدخل نتيجة لكل تحليل.", "Enter a result for every test.") };
    const num = kind === "text" ? null : parseLocaleNumber(raw);
    if (kind !== "text" && num == null) return { error: t(`النتيجة ليست رقماً: ${raw}`, `The result is not a number: ${raw}`) };
    const lo = parseLocaleNumber(str(fd, `r${k}_ref_low`));
    const hi = parseLocaleNumber(str(fd, `r${k}_ref_high`));
    const flag = str(fd, `r${k}_flag`);
    if (!LAB_FLAG.some((f) => f.value === flag)) return { error: t("علامة غير صالحة.", "Invalid flag.") };
    const customName = str(fd, `r${k}_custom_name`, 120);
    if (isOther.has(typeId) && !customName) return { error: t("اكتب اسم التحليل في الصف «تحليل آخر».", "Name the test on every “Other lab test” row.") };
    results.push({
      type_id: typeId, value_num: num, value_text: kind === "text" ? raw : null, unit: str(fd, `r${k}_unit`, 30) || null,
      ref_low: lo, ref_high: hi, ref_text: str(fd, `r${k}_ref_text`, 200) || null, flag: flag || null, notes: str(fd, `r${k}_notes`) || null,
      custom_name: isOther.has(typeId) ? customName : null,
    });
  }
  if (!results.length) return { error: t("أضف نتيجة واحدة على الأقل.", "Add at least one result.") };

  // the same sheet transcribed twice: same test and value within a day and a half of the same sample time
  if (fd.get("_dup_ok") !== "on") {
    const from = new Date(Date.parse(collected) - 36 * 3_600_000).toISOString(), to = new Date(Date.parse(collected) + 36 * 3_600_000).toISOString();
    const { data: near } = await supabase.from("observations").select("type_id, value_num, value_text, custom_name, effective_at")
      .eq("patient_id", pid).in("type_id", results.map((r) => r.type_id as string)).in("status", ["final", "preliminary"])
      .gte("effective_at", from).lte("effective_at", to).limit(1000);
    const dups = results.filter((r) => (near ?? []).some((o) =>
      o.type_id === r.type_id && within(o.effective_at as string, collected, 36) && normText(o.custom_name) === normText(r.custom_name)
      && (r.value_num != null ? sameNumber(o.value_num as number, r.value_num as number) : normText(o.value_text) === normText(r.value_text))));
    if (dups.length) {
      const names = dups.slice(0, 8).map((r) => `• ${(r.custom_name as string) || nameOf.get(r.type_id as string) || "—"}: ${r.value_num ?? r.value_text}`).join("\n");
      return {
        error: t(`هذه النتائج مسجلة من قبل في اليوم نفسه بالقيم نفسها:\n${names}`, `These results are already recorded around the same date with the same values:\n${names}`),
        confirm: dupConfirm(t),
      };
    }
  }

  const orders = fd.getAll("fulfils").map(String).filter((v) => UUID_RE.test(v));
  const encounter = str(fd, "encounter_id");
  const specialty = str(fd, "specialty_id");
  const { data: reportId, error } = await supabase.rpc("create_lab_report", {
    p_patient: pid,
    p_report: {
      title, lab_name: str(fd, "lab_name", 200), specimen_type: str(fd, "specimen_type", 100), collected_at: collected,
      performed_at: iso(str(fd, "performed_at")) ?? "", approved_at: iso(str(fd, "approved_at")) ?? "", approved_by_name: str(fd, "approved_by_name", 200),
      status: str(fd, "status") === "preliminary" ? "preliminary" : "final", lab_notes: str(fd, "lab_notes", 2000),
      specialty_id: UUID_RE.test(specialty) ? specialty : "", encounter_id: UUID_RE.test(encounter) ? encounter : "",
    },
    p_results: results,
  });
  if (error) return { error: explainError(error, t) };
  // requested / suggested tests answered by this report are closed and linked to it
  let closed = 0;
  if (orders.length && typeof reportId === "string") {
    const { data: done } = await supabase.from("test_orders").update({ status: "done", done_on: localDate(collected), report_id: reportId })
      .eq("patient_id", pid).in("id", orders).in("status", ["suggested", "requested"]).select("id");
    closed = done?.length ?? 0;
  }
  revalidatePath(`/patients/${pid}`, "layout");
  return {
    ok: true,
    message: closed
      ? t(`تم حفظ التقرير ونتائجه، وأُغلق ${closed} من الفحوصات المطلوبة.`, `Report and results saved; ${closed} requested test(s) marked done.`)
      : t("تم حفظ التقرير ونتائجه.", "Report and results saved."),
  };
}

/** An approved result is never edited in place: this records a correction that supersedes it. */
export async function correctObservation(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid");
  const id = str(fd, "_id");
  const reason = str(fd, "reason");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب سبب التصحيح.", "Enter the reason for the correction.") };
  const textVal = str(fd, "value_text", 500);
  const v1 = parseLocaleNumber(str(fd, "value_num"));
  const v2 = parseLocaleNumber(str(fd, "value_num2"));
  if (v1 == null && !textVal) return { error: t("أدخل القيمة الصحيحة.", "Enter the corrected value.") };
  const { error } = await createClient().rpc("observation_correct", {
    p_id: id, p_value_num: v1, p_value_num2: v2, p_value_text: textVal || null, p_unit: str(fd, "unit", 30) || null, p_reason: reason,
  });
  if (error) return { error: explainError(error, t) };
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("سُجّل التصحيح وبقيت القيمة الأصلية في التاريخ.", "Correction recorded; the original value stays in the history.") };
}

export async function invalidateObservation(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid");
  const id = str(fd, "_id");
  const reason = str(fd, "reason");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب السبب.", "Enter a reason.") };
  const { data, error } = await createClient().from("observations").update({ status: "entered_in_error", amendment_reason: reason }).eq("id", id).eq("patient_id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على النتيجة.", "Result not found.") };
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("أُبطلت النتيجة وبقيت في السجل.", "Result invalidated and kept in the record.") };
}
