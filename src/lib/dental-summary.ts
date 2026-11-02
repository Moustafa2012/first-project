import { ABSENT_STATUSES, DISEASE_KINDS, deriveChart, type ExamRow, type FindingRow, type ToothImage } from "@/lib/dental";
import { baselineExam, examsNewestFirst, openSoftTissueAlert, pulpAbnormal, type PulpTest } from "@/lib/dental-exam";
import { boneLevelLabel, isWholeMouth, worstBoneLevel, type BoneLevels } from "@/lib/dental-imaging";
import { addMonths, dueState, type DueState } from "@/lib/followups";
import { comparePerio, summarize, type PerioExam, type PerioSummary } from "@/lib/perio";
import type { SafetyAlert } from "@/lib/safety-rules";
import { OPEN_ITEM, OPEN_PLAN, type TreatmentPlan } from "@/lib/treatment";

/**
 * The dental summary: the whole condition of the mouth at a glance, built only from records the screen (or the share link)
 * already holds. Pure: no labels and no I/O, so the page, the doctor's link and the PDF all read the same facts
 * (tests/dental-summary.test.ts). Rendering turns the codes into words.
 */

/** work done on a tooth that counts as a restoration (an implant is counted on its own; a denture or appliance is not a restoration) */
export const RESTORATION_KINDS = new Set(["filling", "sealant", "inlay_onlay", "veneer", "crown", "bridge_abutment", "bridge_pontic", "root_canal", "post_core"]);
const PROPOSED_STATUSES = new Set(["proposed", "planned", "deferred"]);
const ACCEPTED_STATUSES = new Set(["accepted", "scheduled", "in_progress"]);

export interface SummaryRecall { kind: string; label: string | null; interval_months: number; due_on: string; status: string }
export interface DentalSummaryInput {
  /** today as YYYY-MM-DD in the viewer's time zone */
  today: string;
  exams: ExamRow[];
  findings: FindingRow[];
  /** pulp tests by the id of the exam they belong to */
  pulp?: Record<string, PulpTest[]> | null;
  images?: ToothImage[] | null;
  /** periodontal charts with their teeth (drafts are ignored) */
  perio?: PerioExam[] | null;
  plans?: TreatmentPlan[] | null;
  recalls?: SummaryRecall[] | null;
  safety?: SafetyAlert[] | null;
}

export interface SummaryExam { id: string; exam_date: string; examiner_name: string | null }
export interface SummaryItem { id: string; name: string; teeth: number[]; status: string; plan_id: string; plan: string; scheduled_for: string | null; completed_on: string | null }
export interface SummaryPerio {
  id: string; exam_date: string; examiner_name: string | null; dx_kind: string | null; dx_stage: string | null; dx_grade: string | null; dx_extent: string | null;
  dx_rbl_pct: number | null; stats: PerioSummary;
  /** versus the final chart before it (null when there is none) */
  change: null | {
    previous_id: string; previous_date: string; worse: number; better: number; lost: number[];
    bop: [number | null, number | null]; meanPd: [number | null, number | null]; direction: "worse" | "better" | "stable";
  };
}
export interface DentalSummary {
  chart: {
    /** teeth any exam has looked at */
    examined: number; missing: number[]; restored: number[]; implants: number[];
    /** teeth with an unresolved finding that is a problem (caries, a lesion, a defective filling ...) */
    open: number[]; openFindings: number;
  };
  baseline: SummaryExam | null;
  softTissue: (SummaryExam & { note: string | null }) | null;
  perio: SummaryPerio | null;
  /** the newest result of each pulp test on each tooth, only the ones that are not normal */
  pulp: { tooth: number; test: string; result: string; exam_date: string }[];
  image: null | {
    id: string; modality: string; performed_on: string | null; date_precision: string | null; impression: string | null; findings: string | null;
    bone: BoneLevels | null; worst: string | null;
  };
  treatment: { proposed: SummaryItem[]; accepted: SummaryItem[]; completed: SummaryItem[]; completedSince: string };
  safety: { code: string; severity: string; title_ar: string; title_en: string }[];
  recall: null | { kind: string; label: string | null; interval_months: number; due_on: string; state: DueState };
  /** nothing at all is recorded in the dental file */
  empty: boolean;
}

const brief = (e: ExamRow): SummaryExam => ({ id: e.id, exam_date: e.exam_date, examiner_name: e.examiner_name ?? null });
const sortedTeeth = (s: Set<number>) => [...s].sort((a, b) => a - b);

function chartFacts(exams: ExamRow[], findings: FindingRow[]): DentalSummary["chart"] {
  const missing = new Set<number>(), restored = new Set<number>(), implants = new Set<number>(), open = new Set<number>();
  let examined = 0, openFindings = 0;
  for (const v of deriveChart(exams, findings).values()) {
    if (v.status) examined++;
    const implant = v.findings.some((f) => f.kind === "implant");
    if (implant) implants.add(v.tooth);
    else if (v.status && ABSENT_STATUSES.has(v.status)) missing.add(v.tooth);
    if (!implant && !(v.status && ABSENT_STATUSES.has(v.status)) && v.findings.some((f) => RESTORATION_KINDS.has(f.kind))) restored.add(v.tooth);
    const problems = v.findings.filter((f) => DISEASE_KINDS.has(f.kind));
    if (problems.length) { open.add(v.tooth); openFindings += problems.length; }
  }
  return { examined, missing: sortedTeeth(missing), restored: sortedTeeth(restored), implants: sortedTeeth(implants), open: sortedTeeth(open), openFindings };
}

function latestPulp(exams: ExamRow[], pulp: Record<string, PulpTest[]>): DentalSummary["pulp"] {
  const seen = new Set<string>();
  const out: DentalSummary["pulp"] = [];
  for (const e of examsNewestFirst(exams)) {
    for (const p of pulp[e.id] ?? []) {
      const key = `${p.tooth}:${p.test}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (pulpAbnormal(p.result)) out.push({ tooth: p.tooth, test: p.test, result: p.result, exam_date: e.exam_date });
    }
  }
  return out.sort((a, b) => a.tooth - b.tooth || a.test.localeCompare(b.test));
}

const finals = (perio: PerioExam[]) => perio
  .filter((e) => e.status === "final" && (e.record_status ?? "active") === "active")
  .sort((a, b) => b.exam_date.localeCompare(a.exam_date) || String(b.finalized_at ?? b.recorded_at ?? "").localeCompare(String(a.finalized_at ?? a.recorded_at ?? "")));

function perioFacts(perio: PerioExam[]): SummaryPerio | null {
  const [latest, previous] = finals(perio);
  if (!latest) return null;
  const stats = summarize(latest.teeth);
  let change: SummaryPerio["change"] = null;
  if (previous) {
    const cmp = comparePerio(previous.teeth, latest.teeth);
    const worse = cmp.worse.length + cmp.lostTeeth.length, better = cmp.better.length;
    change = {
      previous_id: previous.id, previous_date: previous.exam_date, worse: cmp.worse.length, better, lost: cmp.lostTeeth,
      bop: [cmp.before.bopPct, cmp.after.bopPct], meanPd: [cmp.before.meanPd, cmp.after.meanPd],
      direction: worse > better ? "worse" : worse < better ? "better" : "stable",
    };
  }
  return {
    id: latest.id, exam_date: latest.exam_date, examiner_name: latest.examiner_name ?? null, dx_kind: latest.dx_kind ?? null, dx_stage: latest.dx_stage ?? null,
    dx_grade: latest.dx_grade ?? null, dx_extent: latest.dx_extent ?? null, dx_rbl_pct: latest.dx_rbl_pct ?? null, stats, change,
  };
}

function imageFacts(images: ToothImage[]): DentalSummary["image"] {
  const whole = images.filter((i) => isWholeMouth(i.modality, i.teeth))
    .sort((a, b) => String(b.performed_on ?? "").localeCompare(String(a.performed_on ?? "")));
  const i = whole[0];
  if (!i) return null;
  return {
    id: i.id, modality: i.modality, performed_on: i.performed_on ?? null, date_precision: i.date_precision ?? null, impression: i.impression ?? null,
    findings: i.findings ?? null, bone: i.bone_levels ?? null, worst: worstBoneLevel(i.bone_levels),
  };
}

function treatmentFacts(plans: TreatmentPlan[], today: string): DentalSummary["treatment"] {
  const completedSince = addMonths(today, -12);
  const proposed: SummaryItem[] = [], accepted: SummaryItem[] = [], completed: SummaryItem[] = [];
  const doneKeys = new Set<string>();
  const row = (pl: TreatmentPlan, i: TreatmentPlan["items"][number]): SummaryItem => ({
    id: i.id, name: i.name, teeth: i.teeth ?? [], status: i.status, plan_id: pl.id, plan: pl.title, scheduled_for: i.scheduled_for, completed_on: i.completed_on,
  });
  for (const pl of plans) {
    for (const i of pl.items) {
      if (OPEN_PLAN.has(pl.status) && OPEN_ITEM.has(i.status)) (PROPOSED_STATUSES.has(i.status) ? proposed : ACCEPTED_STATUSES.has(i.status) ? accepted : []).push(row(pl, i));
      else if (i.status === "completed" && i.completed_on && i.completed_on >= completedSince && i.completed_on <= today) {
        // a new plan version carries the completed treatments of the one before: count each once
        const key = `${i.completed_on}|${i.catalog_code ?? i.name}|${[...(i.teeth ?? [])].sort().join(",")}`;
        if (doneKeys.has(key)) continue;
        doneKeys.add(key);
        completed.push(row(pl, i));
      }
    }
  }
  const byPlace = (a: SummaryItem, b: SummaryItem) => (a.teeth[0] ?? 99) - (b.teeth[0] ?? 99) || a.name.localeCompare(b.name);
  return { proposed: proposed.sort(byPlace), accepted: accepted.sort(byPlace), completed: completed.sort((a, b) => String(b.completed_on).localeCompare(String(a.completed_on)) || byPlace(a, b)), completedSince };
}

const SEVERITY_RANK: Record<string, number> = { danger: 0, warn: 1, info: 2 };

export function buildDentalSummary(input: DentalSummaryInput): DentalSummary {
  const { today, exams, findings } = input;
  const baseline = baselineExam(exams);
  const soft = openSoftTissueAlert(exams);
  const recall = (input.recalls ?? []).filter((r) => r.status === "active").sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
  const safety = [...(input.safety ?? [])].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3))
    .map((a) => ({ code: a.code, severity: a.severity, title_ar: a.title_ar, title_en: a.title_en }));
  const out: DentalSummary = {
    chart: chartFacts(exams, findings),
    baseline: baseline ? brief(baseline) : null,
    softTissue: soft ? { ...brief(soft), note: (soft.sections?.soft_tissue?.note as string | undefined) ?? null } : null,
    perio: perioFacts(input.perio ?? []),
    pulp: latestPulp(exams, input.pulp ?? {}),
    image: imageFacts(input.images ?? []),
    treatment: treatmentFacts(input.plans ?? [], today),
    safety,
    recall: recall ? { kind: recall.kind, label: recall.label, interval_months: recall.interval_months, due_on: recall.due_on, state: dueState(recall.due_on, today) } : null,
    empty: false,
  };
  out.empty = exams.length === 0 && findings.length === 0 && !out.perio && !out.image && !out.treatment.proposed.length && !out.treatment.accepted.length
    && !out.treatment.completed.length && !out.recall && !out.safety.length;
  return out;
}

/** "level" of a bone reading in words, for the summary: the worst level read in any sextant */
export const worstBoneText = (worst: string | null, lang: "ar" | "en"): string => (worst ? boneLevelLabel(worst, lang)[lang === "ar" ? 0 : 1] : "");
