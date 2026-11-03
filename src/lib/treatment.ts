import type { Lang } from "@/lib/i18n";

/*
 * Treatment plans and the treatments in them. The life cycle is enforced by the database (0020); the transitions below
 * mirror it so the screens only offer what will be accepted.
 */

type Opt = { value: string; ar: string; en: string };
const o = (value: string, ar: string, en: string): Opt => ({ value, ar, en });

export const ITEM_STATUS: Opt[] = [
  o("proposed", "مقترح", "Proposed"),
  o("planned", "مخطط", "Planned"),
  o("accepted", "موافَق عليه", "Accepted"),
  o("scheduled", "مجدول", "Scheduled"),
  o("in_progress", "قيد التنفيذ", "In progress"),
  o("completed", "منجز", "Completed"),
  o("referred", "محوَّل لطبيب آخر", "Referred"),
  o("cancelled", "ملغى", "Cancelled"),
  o("deferred", "مؤجل", "Deferred"),
];
export const PLAN_STATUS: Opt[] = [
  o("draft", "مسودة", "Draft"),
  o("proposed", "مقترحة", "Proposed"),
  o("accepted", "معتمدة", "Accepted"),
  o("in_progress", "قيد التنفيذ", "In progress"),
  o("completed", "مكتملة", "Completed"),
  o("declined", "غير معتمدة", "Declined"),
  o("cancelled", "ملغاة", "Cancelled"),
  o("superseded", "استُبدلت بنسخة أحدث", "Superseded"),
];
export const PROC_CATEGORY: Opt[] = [
  o("diagnostic", "التشخيص والأشعة", "Diagnostic"),
  o("preventive", "الوقاية", "Preventive"),
  o("restorative", "الترميم والحشوات", "Restorative"),
  o("endodontic", "علاج العصب", "Endodontic"),
  o("periodontal", "اللثة", "Periodontal"),
  o("prosthodontic", "التيجان والتركيبات", "Prosthodontic"),
  o("surgical", "الجراحة والخلع", "Surgical"),
  o("implant", "الزراعة", "Implants"),
  o("orthodontic", "التقويم", "Orthodontic"),
  o("other", "أخرى", "Other"),
];
export const COST_KIND: Opt[] = [o("estimate", "تقدير", "Estimate"), o("quoted", "عرض سعر من العيادة", "Clinic quote"), o("final", "التكلفة النهائية", "Final cost")];
export const CURRENCIES = ["SAR", "AED", "KWD", "QAR", "BHD", "OMR", "EGP", "JOD", "IQD", "SYP", "LBP", "TRY", "USD", "EUR", "GBP"];

export const ITEM_NEXT: Record<string, string[]> = {
  proposed: ["planned", "accepted", "cancelled", "deferred", "referred"],
  planned: ["accepted", "scheduled", "cancelled", "deferred", "referred"],
  accepted: ["scheduled", "in_progress", "completed", "cancelled", "deferred", "referred"],
  scheduled: ["accepted", "in_progress", "completed", "cancelled", "deferred", "referred"],
  in_progress: ["completed", "cancelled", "referred"],
  deferred: ["proposed", "planned", "accepted", "cancelled"],
};
export const PLAN_NEXT: Record<string, string[]> = {
  draft: ["proposed", "accepted", "declined", "cancelled"],
  proposed: ["draft", "accepted", "declined", "cancelled"],
  accepted: ["cancelled"],
  in_progress: ["cancelled"],
};
export const OPEN_ITEM = new Set(["proposed", "planned", "accepted", "scheduled", "in_progress", "deferred"]);
export const OPEN_PLAN = new Set(["draft", "proposed", "accepted", "in_progress"]);
const DONE = new Set(["completed", "referred"]);

/** The statuses a treatment may move to from here; `clinician`: accepting is the patient's decision. */
export function itemNext(status: string, clinician = false): string[] {
  return (ITEM_NEXT[status] ?? []).filter((s) => !(clinician && s === "accepted"));
}

export interface CatalogItem { code: string; category: string; name_ar: string; name_en: string; scope: string; surgical: boolean; finding_kind: string | null; sort: number }
export interface TreatmentItem {
  id: string; plan_id?: string; catalog_code: string | null; name: string; teeth: number[] | null; surfaces: string[] | null; condition_id: string | null;
  phase: number; status: string; surgical: boolean; scheduled_for: string | null; completed_on: string | null; status_reason: string | null;
  notes: string | null; contributed_by: string | null;
}
export interface TreatmentPlan {
  id: string; title: string; status: string; version: number; group_id: string | null; alternative_of: string | null; previous_id?: string | null;
  presented_by: string | null; presented_on: string | null; accepted_on: string | null; notes: string | null; contributed_by: string | null;
  recorded_at: string; items: TreatmentItem[];
}
export interface TreatmentCost { id: string; item_id: string; amount: number | string; currency: string; kind: string; note: string | null; recorded_at?: string; contributed_by?: string | null }

/** Progress of a plan: done (completed or referred) out of what is still meant to happen (cancelled ones do not count). */
export function planProgress(items: Pick<TreatmentItem, "status">[]): { done: number; total: number; pct: number } {
  const counted = items.filter((i) => i.status !== "cancelled");
  const done = counted.filter((i) => DONE.has(i.status)).length;
  return { done, total: counted.length, pct: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

/** Treatments still to happen on each tooth, from the current plans (superseded / cancelled plans are ignored). */
export function plannedByTooth(plans: Pick<TreatmentPlan, "status" | "title" | "items">[]): Map<number, { name: string; status: string; plan: string }[]> {
  const out = new Map<number, { name: string; status: string; plan: string }[]>();
  for (const p of plans) {
    if (!OPEN_PLAN.has(p.status)) continue;
    for (const i of p.items) {
      if (!OPEN_ITEM.has(i.status)) continue;
      for (const t of i.teeth ?? []) out.set(t, [...(out.get(t) ?? []), { name: i.name, status: i.status, plan: p.title }]);
    }
  }
  return out;
}

/**
 * The cost of each treatment is its latest entry (a final cost over a quote over an estimate when several exist);
 * totals are kept per currency and never mixed. Cancelled treatments are left out.
 */
export function costTotals(items: Pick<TreatmentItem, "id" | "status">[], costs: TreatmentCost[]): { byItem: Map<string, TreatmentCost>; totals: { currency: string; amount: number; done: number }[] } {
  const rank: Record<string, number> = { estimate: 0, quoted: 1, final: 2 };
  const byItem = new Map<string, TreatmentCost>();
  for (const c of costs) {
    const cur = byItem.get(c.item_id);
    if (!cur || rank[c.kind] > rank[cur.kind] || (rank[c.kind] === rank[cur.kind] && String(c.recorded_at ?? "") >= String(cur.recorded_at ?? ""))) byItem.set(c.item_id, c);
  }
  const sums = new Map<string, { amount: number; done: number }>();
  for (const i of items) {
    if (i.status === "cancelled") continue;
    const c = byItem.get(i.id);
    if (!c) continue;
    const s = sums.get(c.currency) ?? { amount: 0, done: 0 };
    s.amount += Number(c.amount);
    if (DONE.has(i.status)) s.done += Number(c.amount);
    sums.set(c.currency, s);
  }
  return { byItem, totals: [...sums].map(([currency, s]) => ({ currency, amount: Math.round(s.amount * 100) / 100, done: Math.round(s.done * 100) / 100 })) };
}

export function fmtMoney(amount: number | string, currency: string, lang: Lang): string {
  try { return new Intl.NumberFormat(lang === "ar" ? "ar" : "en", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount)); }
  catch { return `${amount} ${currency}`; }
}

/** The phases of a plan in order, each with its treatments. */
export function byPhase<T extends { phase: number }>(items: T[]): [number, T[]][] {
  const m = new Map<number, T[]>();
  for (const i of items) m.set(i.phase, [...(m.get(i.phase) ?? []), i]);
  return [...m].sort((a, b) => a[0] - b[0]);
}

/** Database errors of the treatment functions, in words. */
export const TREATMENT_ERRORS: Record<string, [string, string]> = {
  surgical_confirmation_required: ["هذا علاج جراحي: لا يُعتمد ولا يُسجَّل منجزاً إلا بتأكيد صريح. ضع علامة على مربع التأكيد.", "This is a surgical treatment: it is accepted or completed only with an explicit confirmation. Tick the confirmation box."],
  invalid_transition: ["لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية (مثلاً: لا يُنجز علاج قبل الموافقة عليه).", "This change of status is not allowed from the current one (e.g. nothing is completed before it was accepted)."],
  plan_closed: ["الخطة مغلقة (مكتملة أو ملغاة أو مستبدلة)؛ لا يُضاف إليها.", "The plan is closed (completed, cancelled or superseded); nothing can be added to it."],
  complete_through_function: ["يُسجَّل الإنجاز من زر تغيير الحالة.", "Completion is recorded with the change-status button."],
  date_in_future: ["التاريخ في المستقبل.", "The date is in the future."],
  unknown_procedure: ["إجراء غير موجود في الكتالوج.", "Unknown procedure."],
  patient_decides: ["الموافقة على العلاج قرار المريض.", "Accepting a treatment is the patient's decision."],
};
export function treatmentError(message: string, t: (ar: string, en: string) => string): string | null {
  const k = Object.keys(TREATMENT_ERRORS).find((x) => message.includes(x));
  return k ? t(...TREATMENT_ERRORS[k]) : null;
}
