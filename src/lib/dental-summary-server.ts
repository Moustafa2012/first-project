import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getProcedureCatalog, getSpecialties } from "@/lib/data";
import { getClinicalContext } from "@/lib/clinical-context-server";
import { getSafetyFacts, getSafetyRules } from "@/lib/safety-server";
import type { ExamRow, FindingRow, ToothImage } from "@/lib/dental";
import type { PulpTest } from "@/lib/dental-exam";
import { buildDentalSummary, type DentalSummary } from "@/lib/dental-summary";
import { activeDrugNames, groupPrescriptions } from "@/lib/prescription";
import type { PerioExam, PerioTooth } from "@/lib/perio";
import { evaluateSafety, type SafetyAlert } from "@/lib/safety-rules";
import { OPEN_ITEM, OPEN_PLAN, type TreatmentItem, type TreatmentPlan } from "@/lib/treatment";

/**
 * Reads what the dental summary needs for one patient with the signed-in account's rights (RLS decides), and builds it with
 * the same function the dental page uses. Used by the summary PDF.
 */
export async function loadPatientDentalSummary(pid: string, today: string): Promise<{ summary: DentalSummary; alerts: SafetyAlert[] }> {
  const supabase = createClient();
  const dent = (await getSpecialties()).find((s) => s.code === "dentistry");
  const [{ data: examRows }, { data: stateRows }, { data: findingRows }, { data: imgRows }, { data: pulpRows }, { data: planRows }, { data: itemRows }, { data: peRows }, { data: rcRows }, { data: rxRows }] = await Promise.all([
    supabase.from("dental_exams").select("*").eq("patient_id", pid).eq("record_status", "active"),
    supabase.from("dental_tooth_states").select("exam_id, tooth, status, note").eq("patient_id", pid),
    supabase.from("dental_findings").select("*").eq("patient_id", pid).eq("record_status", "active"),
    supabase.from("imaging_studies").select("id, modality, body_site, teeth, performed_on, date_precision, impression, findings, bone_levels, specialty_id").eq("patient_id", pid).eq("record_status", "active"),
    supabase.from("dental_pulp_tests").select("exam_id, tooth, test, result, value, note").eq("patient_id", pid),
    supabase.from("treatment_plans").select("*").eq("patient_id", pid).eq("record_status", "active"),
    supabase.from("treatment_items").select("*").eq("patient_id", pid).eq("record_status", "active").order("phase").order("sort"),
    supabase.from("perio_exams").select("*").eq("patient_id", pid).eq("record_status", "active").eq("status", "final")
      .order("exam_date", { ascending: false }).order("recorded_at", { ascending: false }).limit(2),
    supabase.from("recalls").select("kind, label, interval_months, due_on, status").eq("patient_id", pid).eq("record_status", "active")
      .in("kind", ["dental_checkup", "dental_cleaning", "dental_xray", "perio_maintenance", "ortho_review"]).order("due_on"),
    supabase.from("prescriptions").select("*").eq("patient_id", pid).eq("record_status", "active").eq("specialty_id", dent?.id ?? ""),
  ]);
  const exams = (examRows ?? []).map((e) => ({ ...e, states: (stateRows ?? []).filter((s) => s.exam_id === e.id) })) as unknown as ExamRow[];
  const peIds = (peRows ?? []).map((e) => e.id as string);
  const [{ data: peTeeth }, { data: medRows }] = await Promise.all([
    peIds.length ? supabase.from("perio_teeth").select("*").eq("patient_id", pid).in("exam_id", peIds) : Promise.resolve({ data: [] as (PerioTooth & { exam_id: string })[] }),
    (rxRows ?? []).length ? supabase.from("medications").select("*").eq("patient_id", pid).eq("record_status", "active").in("prescription_id", (rxRows ?? []).map((r) => r.id as string)) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const perio = (peRows ?? []).map((e) => ({ ...e, teeth: ((peTeeth ?? []) as (PerioTooth & { exam_id: string })[]).filter((x) => x.exam_id === e.id) })) as unknown as PerioExam[];
  const pulp: Record<string, PulpTest[]> = {};
  for (const x of (pulpRows ?? []) as (PulpTest & { exam_id: string })[]) (pulp[x.exam_id] ??= []).push(x);
  const plans: TreatmentPlan[] = ((planRows ?? []) as TreatmentPlan[]).map((pl) => ({ ...pl, items: ((itemRows ?? []) as (TreatmentItem & { plan_id: string })[]).filter((i) => i.plan_id === pl.id) }));
  const images = ((imgRows ?? []) as (ToothImage & { specialty_id?: string | null })[]).filter((i) => !i.specialty_id || i.specialty_id === dent?.id || (i.teeth?.length ?? 0) > 0);

  const [ctx, rules, facts, catalog] = await Promise.all([getClinicalContext(pid), getSafetyRules(), getSafetyFacts(pid), getProcedureCatalog()]);
  const category = new Map(catalog.map((c) => [c.code, c.category]));
  const alerts = evaluateSafety(rules, {
    context: ctx, labs: facts.labs, history: facts.history, drugs: activeDrugNames(groupPrescriptions((rxRows ?? []) as Record<string, unknown>[], (medRows ?? []) as Record<string, unknown>[])),
    items: plans.filter((pl) => OPEN_PLAN.has(pl.status)).flatMap((pl) => pl.items.filter((i) => OPEN_ITEM.has(i.status))
      .map((i) => ({ id: i.id, name: i.name, catalog_code: i.catalog_code, category: category.get(i.catalog_code ?? "") ?? null, teeth: i.teeth, plan: pl.title }))),
  });
  const summary = buildDentalSummary({
    today, exams, findings: (findingRows ?? []) as FindingRow[], pulp, images, perio, plans, safety: alerts,
    recalls: (rcRows ?? []) as { kind: string; label: string | null; interval_months: number; due_on: string; status: string }[],
  });
  return { summary, alerts };
}
