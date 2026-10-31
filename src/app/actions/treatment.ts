"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { SURFACES, parseTeeth } from "@/lib/dental";
import { COST_KIND, CURRENCIES, ITEM_STATUS, PLAN_STATUS, treatmentError } from "@/lib/treatment";
import type { FormState } from "@/components/ui/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[a-z][a-z0-9_]{1,40}$/;
type T = (ar: string, en: string) => string;
const str = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? "").trim().slice(0, max);
const pathOf = (pid: string) => `/patients/${pid}/dental`;
const fail = (error: { message: string }, t: T): FormState => ({ error: treatmentError(error.message, t) ?? explainError(error, t) });
function done(pid: string) { revalidatePath(pathOf(pid)); revalidatePath(`/patients/${pid}`, "layout"); }

/** One treatment from a form: a catalogue procedure (or a name), the teeth, the surfaces, the problem it treats, the phase. */
function parseItem(fd: FormData, t: T): { item: Record<string, unknown> } | { error: string } {
  const code = str(fd, "catalog_code", 60), name = str(fd, "name", 200);
  if (code && !CODE_RE.test(code)) return { error: t("إجراء غير صالح.", "Invalid procedure.") };
  if (!code && name.length < 2) return { error: t("اختر الإجراء من القائمة أو اكتب اسمه.", "Choose the procedure from the list or type its name.") };
  const teeth = parseTeeth(str(fd, "teeth", 200));
  if (teeth === null) return { error: t("أرقام الأسنان غير صحيحة (FDI، مثل 16 أو 36).", "Invalid tooth numbers (FDI, e.g. 16 or 36).") };
  const surfaces = fd.getAll("surfaces").map(String).filter((s) => (SURFACES as string[]).includes(s));
  if (surfaces.length && teeth.length !== 1) return { error: t("الأسطح تُحدد لسن واحد.", "Surfaces are given for a single tooth.") };
  const cond = str(fd, "condition_id", 40);
  if (cond && !UUID_RE.test(cond)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const phase = Number(str(fd, "phase", 3) || "1");
  if (!Number.isInteger(phase) || phase < 1 || phase > 20) return { error: t("المرحلة بين 1 و20.", "The phase is between 1 and 20.") };
  return { item: { catalog_code: code || null, name: name || null, teeth, surfaces, condition_id: cond || null, phase, notes: str(fd, "notes", 2000) || null } };
}

/** A new plan, with its first treatment when one is given (e.g. "a treatment for this tooth" with no open plan yet). */
export async function createTreatmentPlan(_: FormState, fd: FormData): Promise<FormState> {
  const { t, lang } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const title = str(fd, "title", 200) || t("خطة علاج الأسنان", "Dental treatment plan");
  const alt = str(fd, "alternative_of", 40);
  if (alt && !UUID_RE.test(alt)) return { error: t("طلب غير صالح.", "Invalid request.") };
  let items: Record<string, unknown>[] = [];
  if (str(fd, "catalog_code") || str(fd, "name")) {
    const p = parseItem(fd, t);
    if ("error" in p) return { error: p.error };
    items = [p.item];
  }
  const { error } = await createClient().rpc("treatment_plan_create", {
    p_patient: pid,
    p_plan: { title, lang, alternative_of: alt || null, presented_by: str(fd, "presented_by", 200) || null, notes: str(fd, "plan_notes", 4000) || null },
    p_items: items,
  });
  if (error) return fail(error, t);
  done(pid);
  return { ok: true, message: alt ? t("أُضيف الخيار البديل.", "The alternative was added.") : t("أُنشئت الخطة.", "The plan was created.") };
}

/** A treatment added to an open plan (or to a new plan when "_plan" is "new"). */
export async function addTreatmentItem(prev: FormState, fd: FormData): Promise<FormState> {
  const { t, lang } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), plan = str(fd, "_plan", 40);
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (plan === "new" || !plan) return createTreatmentPlan(prev, fd);
  if (!UUID_RE.test(plan)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const p = parseItem(fd, t);
  if ("error" in p) return { error: p.error };
  const supabase = createClient();
  const it = p.item as { catalog_code: string | null; name: string | null };
  let name = it.name;
  if (!name && it.catalog_code) {
    const { data } = await supabase.from("procedure_catalog").select("name_ar, name_en").eq("code", it.catalog_code).maybeSingle();
    if (!data) return { error: t("إجراء غير موجود في الكتالوج.", "Unknown procedure.") };
    name = lang === "en" ? data.name_en : data.name_ar;
  }
  const { count } = await supabase.from("treatment_items").select("id", { count: "exact", head: true }).eq("plan_id", plan);
  const { error } = await supabase.from("treatment_items").insert({ ...p.item, name, patient_id: pid, plan_id: plan, sort: (count ?? 0) + 1 });
  if (error) return fail(error, t);
  done(pid);
  return { ok: true, message: t("أُضيف العلاج إلى الخطة.", "The treatment was added to the plan.") };
}

/** Move a treatment along; completing it records the procedure and updates the chart (in the database). */
export async function setTreatmentStatus(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), status = str(fd, "status", 20), date = str(fd, "date", 10);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!ITEM_STATUS.some((s) => s.value === status)) return { error: t("اختر الحالة الجديدة.", "Choose the new status.") };
  if (date && !DATE_RE.test(date)) return { error: t("تاريخ غير صالح.", "Invalid date.") };
  const { data, error } = await createClient().rpc("treatment_item_set_status", {
    p_item: id, p_status: status, p_date: date || null, p_reason: str(fd, "reason", 500) || null, p_confirm: fd.get("confirm_surgical") === "on",
  });
  if (error) return fail(error, t);
  done(pid);
  const r = (data ?? {}) as { condition_resolved?: boolean; findings_resolved?: number };
  if (status === "completed") {
    return { ok: true, message: [t("سُجّل العلاج منجزاً، وأُضيف الإجراء إلى الملف وحُدّث المخطط.", "The treatment is recorded as completed; the procedure was added and the chart updated."),
      r.findings_resolved ? t(`أُغلقت ${r.findings_resolved} مشكلة على السن.`, `${r.findings_resolved} problem(s) on the tooth closed.`) : "",
      r.condition_resolved ? t("وأصبح التشخيص المرتبط «شُفي / انتهى».", "The linked diagnosis is now resolved.") : ""].filter(Boolean).join(" ") };
  }
  return { ok: true, message: t("تغيّرت الحالة وحُفظ التغيير في سجلها.", "Status changed; the change is kept in its history.") };
}

/** Propose, accept (with its treatments; the other options are declined), decline or cancel a plan. */
export async function setPlanStatus(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), status = str(fd, "status", 20);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || !PLAN_STATUS.some((s) => s.value === status)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("treatment_plan_set_status", {
    p_plan: id, p_status: status, p_reason: str(fd, "reason", 500) || null, p_confirm: fd.get("confirm_surgical") === "on",
  });
  if (error) return fail(error, t);
  done(pid);
  return { ok: true, message: status === "accepted" ? t("اعتُمدت الخطة وعلاجاتها.", "The plan and its treatments were accepted.") : t("تغيّرت حالة الخطة.", "The plan's status changed.") };
}

/** A new version: open treatments are carried over as proposals; the old version is kept. */
export async function newPlanVersion(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("treatment_plan_new_version", { p_plan: id, p_reason: str(fd, "reason", 500) || null });
  if (error) return fail(error, t);
  done(pid);
  return { ok: true, message: t("أُنشئت نسخة جديدة من الخطة؛ النسخة السابقة محفوظة.", "A new version of the plan was created; the previous one is kept.") };
}

/** A private cost noted against a treatment (never shared). */
export async function addTreatmentCost(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const amount = Number(str(fd, "amount", 20).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,،\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e10) return { error: t("أدخل مبلغاً صحيحاً.", "Enter a valid amount.") };
  const currency = str(fd, "currency", 3).toUpperCase(), kind = str(fd, "kind", 20) || "estimate";
  if (!CURRENCIES.includes(currency) || !COST_KIND.some((k) => k.value === kind)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().from("treatment_costs").insert({ patient_id: pid, item_id: id, amount, currency, kind, note: str(fd, "note", 300) || null });
  if (error) return fail(error, t);
  done(pid);
  return { ok: true, message: t("حُفظت التكلفة (خاصة بك، لا تظهر في المشاركة).", "Cost saved (private: not shared).") };
}

/** A plan or a cost entered by mistake: invalidated with a reason (a plan takes its treatments with it). */
export async function invalidateTreatment(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid", 40), id = str(fd, "_id", 40), table = str(fd, "_table", 30), reason = str(fd, "reason", 500);
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || !["treatment_plans", "treatment_items", "treatment_costs"].includes(table)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب السبب.", "Give the reason.") };
  const { error } = await createClient().from(table).update({ record_status: "entered_in_error", invalidated_reason: reason }).eq("id", id).eq("patient_id", pid);
  if (error) return fail(error, t);
  done(pid);
  return { ok: true, message: t("أُبطل مع السبب، ويبقى في السجل.", "Invalidated with the reason; it stays in the history.") };
}
