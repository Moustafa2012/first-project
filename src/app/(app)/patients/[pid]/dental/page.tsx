import Link from "next/link";
import { Share2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient, getProcedureCatalog, getSpecialties } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtPartialDate, localDate } from "@/lib/format";
import { ENTITIES } from "@/lib/entities";
import { IMAGING_MODALITY, SOURCE, lbl } from "@/lib/labels";
import { isWholeMouth, type AnnotationRow } from "@/lib/dental-imaging";
import { addImagingAnnotation, invalidateImagingAnnotation } from "@/app/actions/imaging";
import {
  ABSENT_STATUSES, ANXIETY, BRUSHING, DENTITION, EXAM_KIND, FINDING_KIND, FLOSSING, ORAL_HYGIENE, TOOTH_STATUS, chartDentition, compareExams, deriveChart, fmtSurfaces,
  type ExamRow, type FindingRow,
} from "@/lib/dental";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { EntitySection } from "@/components/EntitySection";
import { EntityForm } from "@/components/EntityForm";
import { DentalChart, type DentalDiagnosis, type ToothAddForm } from "@/components/dental/DentalChart";
import { DENTAL_DIAGNOSES, OPEN_PROBLEM, type ToothImage, type ToothProcedure } from "@/lib/dental";
import { setConditionTeeth } from "@/app/actions/dental";
import { ExamEditor } from "@/components/dental/ExamEditor";
import { PerioSection } from "@/components/dental/PerioSection";
import { DentalSummary } from "@/components/dental/DentalSummary";
import { buildDentalSummary } from "@/lib/dental-summary";
import type { PerioExam, PerioTooth } from "@/lib/perio";
import { ExamExtras } from "@/components/dental/ExamExtras";
import { baselineExam, openSoftTissueAlert, type PulpTest, type Sections } from "@/lib/dental-exam";
import { ClinicalContext } from "@/components/ClinicalContext";
import { getClinicalContext } from "@/lib/clinical-context-server";
import { invalidateDental, saveDentalExam, saveDentalProfile } from "@/app/actions/dental";
import { TreatmentItemForm, TreatmentPlans, type TreatmentActions } from "@/components/dental/TreatmentPlans";
import { addTreatmentCost, addTreatmentItem, createTreatmentPlan, invalidateTreatment, newPlanVersion, setPlanStatus, setTreatmentStatus } from "@/app/actions/treatment";
import { OPEN_ITEM, OPEN_PLAN, type TreatmentCost, type TreatmentItem, type TreatmentPlan } from "@/lib/treatment";
import { pendingFollowUps, type Recall } from "@/lib/followups";
import { PendingList, RecallList } from "@/components/dental/FollowUps";
import { RECALL_KIND } from "@/lib/labels";
import { Prescriptions } from "@/components/rx/Prescriptions";
import { RxForm } from "@/components/rx/RxForm";
import { ConsentList } from "@/components/rx/Consents";
import { ConsentForm, type ConsentTarget } from "@/components/rx/ConsentForm";
import { SafetyAlerts, SafetyList } from "@/components/SafetyAlerts";
import { activeDrugNames, groupPrescriptions } from "@/lib/prescription";
import { consentsForPlan, type ConsentRow } from "@/lib/consent";
import { alertsByItem, evaluateSafety } from "@/lib/safety-rules";
import { getSafetyFacts, getSafetyRules } from "@/lib/safety-server";
import { createPrescription, invalidatePrescription, setPrescriptionStatus } from "@/app/actions/prescriptions";
import { signConsent, withdrawConsent } from "@/app/actions/consents";

type Profile = Record<string, string | boolean | null>;

export default async function DentalPage({ params, searchParams }: { params: { pid: string }; searchParams: { uploaded?: string; error?: string; asof?: string; a?: string; b?: string; tab?: string; pv?: string; pa?: string; pb?: string; pnew?: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const [access, specs, ctx, catalog] = await Promise.all([getAccess(p.id), getSpecialties(), getClinicalContext(p.id), getProcedureCatalog()]);
  const dent = specs.find((s) => s.code === "dentistry");
  const supabase = createClient();
  const [{ data: profile }, { data: examRows }, { data: stateRows }, { data: findingRows }, { data: condRows }, { data: ctrRows }, { data: procRows }, { data: imgRows }, { data: pulpRows }] = await Promise.all([
    supabase.from("dental_profiles").select("*").eq("patient_id", p.id).maybeSingle(),
    supabase.from("dental_exams").select("*").eq("patient_id", p.id).eq("record_status", "active").order("exam_date", { ascending: false }).order("recorded_at", { ascending: false }),
    supabase.from("dental_tooth_states").select("exam_id, tooth, status, note").eq("patient_id", p.id),
    supabase.from("dental_findings").select("*").eq("patient_id", p.id).eq("record_status", "active").order("observed_on", { ascending: false }),
    supabase.from("conditions").select("id, name, teeth, certainty, clinical_status, contributed_by, resolved_date, onset_date, specialty_id").eq("patient_id", p.id).eq("record_status", "active"),
    supabase.from("share_contributors").select("id, full_name").eq("patient_id", p.id),
    supabase.from("procedures").select("id, name, kind, teeth, performed_on, date_precision, operator_name, contributed_by").eq("patient_id", p.id).eq("record_status", "active"),
    supabase.from("imaging_studies").select("id, modality, body_site, teeth, performed_on, date_precision, impression, findings, bone_levels, specialty_id, contributed_by")
      .eq("patient_id", p.id).eq("record_status", "active").order("performed_on", { ascending: false, nullsFirst: false }),
    supabase.from("dental_pulp_tests").select("exam_id, tooth, test, result, value, note").eq("patient_id", p.id).order("tooth"),
  ]);
  const pulpOf = (examId: string) => ((pulpRows ?? []) as (PulpTest & { exam_id: string })[]).filter((x) => x.exam_id === examId);
  // treatment plans, their treatments and the private costs
  const [{ data: planRows }, { data: itemRows }, { data: costRows }] = await Promise.all([
    supabase.from("treatment_plans").select("*").eq("patient_id", p.id).eq("record_status", "active").order("recorded_at", { ascending: false }),
    supabase.from("treatment_items").select("*").eq("patient_id", p.id).eq("record_status", "active").order("phase").order("sort"),
    supabase.from("treatment_costs").select("*").eq("patient_id", p.id).eq("record_status", "active"),
  ]);
  const plans: TreatmentPlan[] = ((planRows ?? []) as TreatmentPlan[]).map((pl) => ({ ...pl, items: ((itemRows ?? []) as (TreatmentItem & { plan_id: string })[]).filter((i) => i.plan_id === pl.id) }));
  const costs = (costRows ?? []) as TreatmentCost[];
  // prescriptions (with their medicines) and consents of the dental file, and the safety alerts the reviewable rules raise
  const [{ data: rxRows }, { data: consentRows }, safetyRules, safetyFacts] = await Promise.all([
    supabase.from("prescriptions").select("*").eq("patient_id", p.id).eq("record_status", "active").eq("specialty_id", dent?.id ?? "").order("issued_on", { ascending: false }).order("recorded_at", { ascending: false }),
    supabase.from("consents").select("*").eq("patient_id", p.id).eq("record_status", "active").order("signed_at", { ascending: false }),
    getSafetyRules(), getSafetyFacts(p.id),
  ]);
  const { data: rxMedRows } = (rxRows ?? []).length
    ? await supabase.from("medications").select("*").eq("patient_id", p.id).eq("record_status", "active").in("prescription_id", (rxRows ?? []).map((r) => r.id as string))
    : { data: [] as Record<string, unknown>[] };
  const prescriptions = groupPrescriptions((rxRows ?? []) as Record<string, unknown>[], (rxMedRows ?? []) as Record<string, unknown>[]);
  const consents = ((consentRows ?? []) as (ConsentRow & { specialty_id: string | null })[]).filter((c) => c.treatment_plan_id || c.treatment_item_id || c.specialty_id === dent?.id);
  const catalogCategory = new Map(catalog.map((c) => [c.code, c.category]));
  const safety = evaluateSafety(safetyRules, {
    context: ctx, labs: safetyFacts.labs, history: safetyFacts.history, drugs: activeDrugNames(prescriptions),
    items: plans.filter((pl) => OPEN_PLAN.has(pl.status)).flatMap((pl) => pl.items.filter((i) => OPEN_ITEM.has(i.status))
      .map((i) => ({ id: i.id, name: i.name, catalog_code: i.catalog_code, category: catalogCategory.get(i.catalog_code ?? "") ?? null, teeth: i.teeth, plan: pl.title }))),
  });
  const safetyByItem = alertsByItem(safety);
  const consentTargets: ConsentTarget[] = plans.filter((pl) => OPEN_PLAN.has(pl.status)).flatMap((pl) => [
    { id: `plan:${pl.id}`, kind: "plan" as const, label: pl.title, plan_id: pl.id },
    ...pl.items.filter((i) => OPEN_ITEM.has(i.status)).map((i) => ({ id: `item:${i.id}`, kind: "item" as const, plan_id: pl.id,
      label: `${i.name}${i.teeth?.length ? ` (${i.teeth.join(", ")})` : ""}` })),
  ]);
  const openPlans = plans.filter((pl) => OPEN_PLAN.has(pl.status));
  const planned = openPlans.flatMap((pl) => pl.items.filter((i) => OPEN_ITEM.has(i.status) && i.teeth?.length)
    .map((i) => ({ id: i.id, name: i.name, status: i.status, plan: pl.title, plan_id: pl.id, teeth: i.teeth })));
  const imgIds = (imgRows ?? []).map((i) => i.id as string);
  const { data: imgDocs } = imgIds.length
    ? await supabase.from("medical_documents").select("id, title, imaging_id, mime_type").eq("patient_id", p.id).eq("record_status", "active").in("imaging_id", imgIds).order("uploaded_at")
    : { data: [] as { id: string; title: string; imaging_id: string; mime_type: string }[] };
  const { data: annRows } = imgIds.length
    ? await supabase.from("imaging_annotations").select("id, imaging_id, document_id, shapes, recorded_at, contributed_by, source_detail").eq("patient_id", p.id)
      .eq("record_status", "active").in("imaging_id", imgIds).order("recorded_at")
    : { data: [] as { id: string; imaging_id: string; document_id: string; shapes: AnnotationRow["shapes"]; recorded_at: string; contributed_by: string | null; source_detail: string | null }[] };
  const procedures = ((procRows ?? []) as ToothProcedure[]).filter((x) => Array.isArray(x.teeth) && x.teeth.length);
  // images that name teeth, and the whole-mouth ones (a panoramic, CBCT or cephalometric image of dentistry) that name none
  const images = ((imgRows ?? []) as (ToothImage & { specialty_id?: string | null })[])
    .filter((x) => (Array.isArray(x.teeth) && x.teeth.length) || (isWholeMouth(x.modality, x.teeth) && (!x.specialty_id || x.specialty_id === dent?.id)))
    .map((i) => ({ ...i, documents: (imgDocs ?? []).filter((d) => d.imaging_id === i.id).map((d) => ({ id: d.id as string, title: d.title as string, mime_type: d.mime_type as string })) }));
  const annotations: AnnotationRow[] = (annRows ?? []).map((a) => ({ id: a.id, imaging_id: a.imaging_id, document_id: a.document_id, shapes: a.shapes, recorded_at: a.recorded_at,
    contributed_by: a.contributed_by, by: a.source_detail }));
  const exams: ExamRow[] = (examRows ?? []).map((e) => ({ ...e, states: (stateRows ?? []).filter((s) => s.exam_id === e.id) })) as ExamRow[];
  const findings = (findingRows ?? []) as FindingRow[];
  const allConds = (condRows ?? []) as (DentalDiagnosis & { specialty_id: string | null })[];
  const diagnoses = allConds.filter((c) => Array.isArray(c.teeth) && c.teeth.length > 0);
  // dental problems that do not name a tooth yet (they cannot be drawn until they do)
  const unassigned = allConds.filter((c) => c.specialty_id === dent?.id && !(c.teeth?.length) && OPEN_PROBLEM.has(c.clinical_status ?? "active") && c.certainty !== "refuted");
  const tab = ["chart", "problems", "treatment", "perio", "followup", "care", "imaging", "profile"].includes(searchParams.tab ?? "") ? searchParams.tab! : "chart";
  const contributors = Object.fromEntries((ctrRows ?? []).map((c) => [c.id as string, c.full_name as string]));
  const pr = (profile ?? null) as Profile | null;
  const dentition = chartDentition(pr as { dentition?: string } | null, exams);
  const today = localDate(new Date(), tz);
  const asExam = exams.find((e) => e.id === searchParams.asof);
  const ea = exams.find((e) => e.id === searchParams.a), eb = exams.find((e) => e.id === searchParams.b);
  const changes = ea && eb && ea.id !== eb.id ? compareExams(ea, eb, findings) : null;
  const base = `/patients/${p.id}/dental`;
  // added from the panel of the chosen tooth: the tooth (and the specialty) are known, so they are not asked
  const fixedSpec: Record<string, string> = dent ? { specialty_id: dent.id } : {};
  const openProblems = allConds.filter((c) => (c.teeth?.length || c.specialty_id === dent?.id) && OPEN_PROBLEM.has(c.clinical_status ?? "active") && c.certainty !== "refuted")
    .map((c) => ({ id: c.id, name: c.name, teeth: c.teeth }));
  const txActions: TreatmentActions = {
    hidden: { _pid: p.id }, status: setTreatmentStatus,
    ...(access.canWrite ? { planStatus: setPlanStatus, newVersion: newPlanVersion, createPlan: createTreatmentPlan, addItem: addTreatmentItem, addCost: addTreatmentCost, invalidate: invalidateTreatment } : {}),
    pdfHref: (id: string) => `/api/patients/${p.id}/treatment-plans/${id}/pdf`,
  };
  const toothAdd: ToothAddForm[] = access.canWrite ? [
    { id: "tooth-tx", label: t("علاج مقترح لهذا السن", "A treatment for this tooth"), node: (
      <TreatmentItemForm action={addTreatmentItem} hidden={{ _pid: p.id }} catalog={catalog} problems={openProblems} lang={lang} idPrefix="tooth-tx" formId="tooth-tx"
        plans={openPlans.map((pl) => ({ id: pl.id, title: pl.title }))} externalTeeth submitLabel={t("إضافة إلى الخطة", "Add to the plan")} />) },
    { id: "tooth-dx", label: t("تشخيص لهذا السن", "A diagnosis for this tooth"), node: (
      <EntityForm entity={ENTITIES.conditions} pid={p.id} specialties={specs} returnPath={base} formId="tooth-dx" submitLabel={t("إضافة التشخيص", "Add the diagnosis")}
        context={{ fixed: { ...fixedSpec, category: "diagnosis" }, dental: true, external: ["teeth"],
          pick: ["name", "clinical_status", "certainty", "evidence", "onset_date", "notes"],
          suggest: { name: DENTAL_DIAGNOSES.map((d) => (lang === "ar" ? d.ar : d.en)) } }} />) },
    { id: "tooth-px", label: t("إجراء على هذا السن", "A procedure on this tooth"), node: (
      <EntityForm entity={ENTITIES.procedures} pid={p.id} specialties={specs} returnPath={base} formId="tooth-px" submitLabel={t("إضافة الإجراء", "Add the procedure")}
        context={{ fixed: { ...fixedSpec, kind: "dental" }, dental: true, external: ["teeth"], pick: ["name", "performed_on", "operator_name", "facility_name", "outcome", "notes"] }} />) },
    { id: "tooth-img", label: t("صورة أو أشعة لهذا السن", "An image or X-ray of this tooth"), node: (
      <EntityForm entity={ENTITIES.imaging} pid={p.id} specialties={specs} returnPath={base} formId="tooth-img" submitLabel={t("إضافة الصورة", "Add the image")}
        defaults={{ modality: "dental_xray" }} context={{ fixed: fixedSpec, dental: true, external: ["teeth"], pick: ["modality", "performed_on", "findings", "impression"] }} />) },
  ] : [];
  const examLabel = (e: ExamRow) => `${fmtPartialDate(e.exam_date, "day", lang)} — ${lbl(EXAM_KIND, e.kind, lang)}${e.examiner_name ? ` — ${e.examiner_name}` : ""}`;
  const day = (v: string) => fmtPartialDate(v, "day", lang);
  const yn = (v: unknown) => (v === true ? "yes" : v === false ? "no" : "");
  // the dental summary (top of the chart tab): the latest two final periodontal charts and the recalls are read only for it
  const summary = await (async () => {
    if (tab !== "chart") return null;
    const [{ data: pe }, { data: rc }] = await Promise.all([
      supabase.from("perio_exams").select("*").eq("patient_id", p.id).eq("record_status", "active").eq("status", "final")
        .order("exam_date", { ascending: false }).order("recorded_at", { ascending: false }).limit(2),
      supabase.from("recalls").select("kind, label, interval_months, due_on, status").eq("patient_id", p.id).eq("record_status", "active")
        .in("kind", ["dental_checkup", "dental_cleaning", "dental_xray", "perio_maintenance", "ortho_review"]).order("due_on"),
    ]);
    const peIds = (pe ?? []).map((e) => e.id as string);
    const { data: pt } = peIds.length ? await supabase.from("perio_teeth").select("*").eq("patient_id", p.id).in("exam_id", peIds) : { data: [] as (PerioTooth & { exam_id: string })[] };
    const perio = (pe ?? []).map((e) => ({ ...e, teeth: ((pt ?? []) as (PerioTooth & { exam_id: string })[]).filter((x) => x.exam_id === e.id) })) as unknown as PerioExam[];
    const pulp: Record<string, PulpTest[]> = {};
    for (const x of (pulpRows ?? []) as (PulpTest & { exam_id: string })[]) (pulp[x.exam_id] ??= []).push(x);
    return buildDentalSummary({ today, exams, findings, pulp, images, perio, plans, recalls: (rc ?? []) as { kind: string; label: string | null; interval_months: number; due_on: string; status: string }[], safety });
  })();

  return (
    <>
      <PageHead
        title={t("ملف الأسنان", "Dental file")}
        sub={t("مخطط الأسنان والفحوص والموجودات على كل سن وسطح، مع تاريخ كامل لا يُمسح.", "Tooth chart, exams and findings per tooth and surface, with a history that is never overwritten.")}
        actions={<>
          {access.canShare && <Link className="btn primary" href={`/patients/${p.id}/sharing/new?specialty=dentistry`}><Share2 size={16} aria-hidden="true" />{t("شارك مع طبيب الأسنان", "Share with the dentist")}</Link>}
        </>}
      />

      <ClinicalContext ctx={ctx} lang={lang} tz={tz} codes={["dentistry"]} coreHref={`/patients/${p.id}/profile`} />
      <SafetyAlerts alerts={safety} lang={lang} />


      {tab === "chart" && (<>
      {summary && (
        <DentalSummary s={summary} lang={lang} tz={tz}
          links={{ exam: (id) => `#exam-${id}`, chart: "#chart", perio: `${base}?tab=perio`, imaging: `${base}?tab=imaging`, treatment: `${base}?tab=treatment`, recalls: `${base}?tab=followup`,
            pdf: `/api/patients/${p.id}/dental/summary/pdf` }} />
      )}
      {(() => {
        const baseline = baselineExam(exams);
        const latestSoft = openSoftTissueAlert(exams);
        return (<>
          {latestSoft && (
            <Banner tone="bad" title={t("آفة مشتبهة في الأنسجة الرخوة", "Suspicious soft-tissue lesion")}>
              {t(`سُجّلت في فحص ${day(latestSoft.exam_date)} وتحتاج متابعة أو تحويلاً لأخصائي.`, `Recorded at the exam of ${day(latestSoft.exam_date)}; it needs follow-up or a specialist.`)}
              {" "}<a href={`#exam-${latestSoft.id}`}>{t("عرض الفحص", "See the exam")}</a>
            </Banner>
          )}
          <p className="small baseline-line">{baseline
            ? <>{t("الحالة الابتدائية:", "Baseline:")} <a href={`#exam-${baseline.id}`}>{t(`الفحص الأساسي الشامل في ${day(baseline.exam_date)}`, `the comprehensive baseline exam of ${day(baseline.exam_date)}`)}</a>{baseline.examiner_name ? ` — ${baseline.examiner_name}` : ""}</>
            : <span className="muted">{t("لا يوجد فحص أساسي شامل بعد: أول فحص كامل للأسنان والفم يُعلَّم «فحص أساسي» ليُقرأ عليه كل ما بعده.", "No comprehensive baseline exam yet: mark the first full exam of the teeth and mouth as the baseline so later exams are read against it.")}</span>}</p>
        </>);
      })()}

      <Card id="chart" title={asExam ? t(`المخطط كما كان في ${day(asExam.exam_date)}`, `The chart as of ${day(asExam.exam_date)}`) : t("مخطط الأسنان الحالي", "Current tooth chart")}
        actions={exams.length > 0 ? (
          <form method="get" action={`${base}#chart`} className="row">
            <input type="hidden" name="tab" value="chart" />
            <label className="sr-only" htmlFor="asof">{t("عرض المخطط في تاريخ", "Show the chart as of")}</label>
            <select id="asof" name="asof" defaultValue={asExam?.id ?? ""}>
              <option value="">{t("الآن", "Now")}</option>
              {exams.map((e) => <option key={e.id} value={e.id}>{t("بعد فحص ", "After the exam of ")}{day(e.exam_date)}</option>)}
            </select>
            <button className="btn sm">{t("عرض", "Show")}</button>
          </form>
        ) : undefined}>
        {exams.length === 0 && findings.length === 0 && (
          <p className="muted small">{t("لا يوجد فحص مسجل بعد. ابدأ بتسجيل آخر فحص أسنان (ولو من ذاكرتك أو تقرير الطبيب)، أو شارك الملف مع طبيب الأسنان ليسجّله.",
            "No exam recorded yet. Start with your last dental exam (from memory or the dentist's report), or share the file with your dentist so they can record it.")}</p>
        )}
        <DentalChart dentition={dentition} exams={exams} findings={findings} diagnoses={diagnoses} contributors={contributors} lang={lang}
          pid={p.id} canWrite={access.canWrite} today={today} asOf={asExam?.exam_date ?? null} specialtyId={dent?.id ?? null}
          procedures={procedures} images={images} problemsHref={`${base}?tab=problems#diagnoses`} toothAdd={toothAdd}
          planned={planned} treatmentHref={`${base}?tab=treatment`}
          viewer={{ docBase: "/api/documents/", annotations: {
            rows: annotations,
            ...(access.canWrite ? { add: addImagingAnnotation, addHidden: { _pid: p.id }, remove: invalidateImagingAnnotation, removeHidden: { _pid: p.id } } : {}),
          } }} />
      </Card>

      {access.canWrite && (
        <Card id="new-exam" title={t("تسجيل فحص أسنان", "Record a dental exam")}>
          <details className="fold">
            <summary>{t("فحص جديد على المخطط", "New exam on the chart")}</summary>
            <div className="fold-body">
              <p className="small muted">{t("ما تسجله أنت يظهر «إفادة غير موثقة» حتى يؤكده طبيب. اختر «إفادة المريض» نوعاً للفحص إن لم يكن فحصاً سريرياً.",
                "What you record shows as “unverified” until a clinician confirms it. Choose “Patient's own account” as the kind if it was not a clinical exam.")}</p>
              <ExamEditor action={saveDentalExam} hidden={{ _pid: p.id }} lang={lang} today={today} defaultDentition={dentition}
                conditions={diagnoses.map((d) => ({ id: d.id, name: d.name, teeth: d.teeth }))} idPrefix="px" evidenceDefault="patient_reported"
                knownStates={[...deriveChart(exams, findings).values()].filter((v) => v.status).map((v) => ({ tooth: v.tooth, status: v.status! }))}
                suggestBaseline={!exams.some((e) => (e as ExamRow & { is_baseline?: boolean }).is_baseline)}
                images={images.map((i) => ({ id: i.id, label: `${lbl(IMAGING_MODALITY, i.modality, lang)}${i.performed_on ? ` ${fmtPartialDate(i.performed_on, i.date_precision ?? "day", lang)}` : ""}` }))} />
            </div>
          </details>
        </Card>
      )}

      <Card id="exams" title={t(`الفحوص (${exams.length})`, `Exams (${exams.length})`)}>
        {exams.length === 0 ? <Empty>{t("لا فحوص بعد.", "No exams yet.")}</Empty> : (
          <>
            {exams.length > 1 && (
              <form method="get" action={`${base}#compare`} className="row compare-form">
                <input type="hidden" name="tab" value="chart" />
                <label htmlFor="cmp_a">{t("قارن", "Compare")}</label>
                <select id="cmp_a" name="a" defaultValue={ea?.id ?? exams[1].id}>{exams.map((e) => <option key={e.id} value={e.id}>{examLabel(e)}</option>)}</select>
                <label htmlFor="cmp_b">{t("مع", "with")}</label>
                <select id="cmp_b" name="b" defaultValue={eb?.id ?? exams[0].id}>{exams.map((e) => <option key={e.id} value={e.id}>{examLabel(e)}</option>)}</select>
                <button className="btn sm">{t("قارن", "Compare")}</button>
              </form>
            )}
            {exams.map((e) => {
              const fs = findings.filter((f) => f.exam_id === e.id);
              return (
                <article key={e.id} className="rec" id={`exam-${e.id}`}>
                  <div className="row between">
                    <span className="row" style={{ gap: ".4rem" }}><strong>{day(e.exam_date)}</strong> {lbl(EXAM_KIND, e.kind, lang)}
                      {(e as ExamRow & { is_baseline?: boolean }).is_baseline && <Chip tone="ok">{t("فحص أساسي", "Baseline")}</Chip>}
                      {e.contributed_by ? <Chip tone="info">{t(`أضافه ${contributors[e.contributed_by] ?? "طبيب"} عبر رابط`, `Added by ${contributors[e.contributed_by] ?? "a doctor"} via a link`)}</Chip>
                        : e.verification === "reported" ? <Chip tone="muted">{t("إفادة غير موثقة", "Unverified (reported)")}</Chip> : <Chip tone="ok">{t("موثّق", "Confirmed")}</Chip>}
                      <Chip tone="muted">{lbl(SOURCE, e.source, lang)}</Chip></span>
                    <Link className="btn sm" href={`${base}?tab=chart&asof=${e.id}#chart`}>{t("المخطط في هذا التاريخ", "Chart at this date")}</Link>
                  </div>
                  <p className="small muted">{[e.examiner_name, e.facility_name, e.oral_hygiene && `${t("نظافة الفم", "Oral hygiene")}: ${lbl(ORAL_HYGIENE, e.oral_hygiene, lang)}`].filter(Boolean).join(" · ")}
                    {" · "}{t(`${e.states.length} سن · ${fs.length} موجود`, `${e.states.length} teeth · ${fs.length} findings`)}</p>
                  {e.chief_complaint && <p className="small">{t("الشكوى", "Complaint")}: {e.chief_complaint}</p>}
                  {fs.length > 0 && <p className="small">{fs.map((f) => `${f.tooth}${f.surfaces.length ? " " + fmtSurfaces(f.surfaces, f.tooth) : ""} ${lbl(FINDING_KIND, f.kind, lang)}`).join(" · ")}</p>}
                  <ExamExtras sections={(e as ExamRow & { sections?: Sections | null }).sections} pulp={pulpOf(e.id)} lang={lang} />
                  {e.notes && <p className="small">{e.notes}</p>}
                  {access.canWrite && (
                    <details className="fold"><summary>{t("أُدخل خطأً", "Entered in error")}</summary><div className="fold-body">
                      <ActionForm action={invalidateDental} className="row">
                        <input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={e.id} /><input type="hidden" name="_table" value="dental_exams" />
                        <input name="reason" required minLength={3} maxLength={400} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 180 }} />
                        <ConfirmButton message={t("إبطال هذا الفحص وكل ما سُجّل فيه؟ يبقى في التاريخ مع السبب.", "Invalidate this exam and everything recorded in it? It stays in the history with the reason.")}>{t("إبطال الفحص", "Invalidate the exam")}</ConfirmButton>
                      </ActionForm></div></details>
                  )}
                </article>
              );
            })}
          </>
        )}
      </Card>

      {changes && ea && eb && (
        <Card id="compare" title={t("مقارنة فحصين", "Comparing two exams")}>
          <p className="small muted">{examLabel(ea.exam_date <= eb.exam_date ? ea : eb)} ← {examLabel(ea.exam_date <= eb.exam_date ? eb : ea)}</p>
          {changes.length === 0 ? <Empty>{t("لا فرق مسجل بين الفحصين.", "No recorded difference between the two exams.")}</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t("السن", "Tooth")}</th><th>{t("الحالة قبل", "State before")}</th><th>{t("الحالة بعد", "State after")}</th><th>{t("ظهر", "New")}</th><th>{t("لم يعد مسجلاً", "No longer recorded")}</th></tr></thead>
              <tbody>{changes.map((c) => (
                <tr key={c.tooth}>
                  <td className="ltr">{c.tooth}</td>
                  <td>{c.before ? lbl(TOOTH_STATUS, c.before, lang) : <span className="muted">—</span>}</td>
                  <td>{c.after ? lbl(TOOTH_STATUS, c.after, lang) : <span className="muted">{t("لم يُفحص", "not examined")}</span>}</td>
                  <td>{c.added.map((f) => `${lbl(FINDING_KIND, f.kind, lang)}${f.surfaces.length ? " " + fmtSurfaces(f.surfaces, c.tooth) : ""}`).join("، ") || "—"}</td>
                  <td>{c.removed.map((f) => `${lbl(FINDING_KIND, f.kind, lang)}${f.surfaces.length ? " " + fmtSurfaces(f.surfaces, c.tooth) : ""}`).join("، ") || "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="small muted">{t("المقارنة بين ما سجّله كل فحص؛ سن لم يسجّله أحد الفحصين يظهر «لم يُفحص» وليس «سليم».", "The comparison is between what each exam recorded; a tooth one exam did not record shows “not examined”, not “healthy”.")}</p>
        </Card>
      )}

      </>)}

      {tab === "problems" && (<>
        {unassigned.length > 0 && (
          <Card id="unassigned" title={t("مشكلات سنية بلا سن محدد", "Dental problems without a tooth")}>
            <p className="small muted">{t("لا تظهر على المخطط حتى تُحدَّد أسنانها. اكتب رقم السن (FDI) إن عرفته، أو اتركها حتى يحدده الطبيب.", "They are not drawn on the chart until their teeth are known. Enter the tooth number (FDI) if you know it, or leave it for the dentist.")}</p>
            <ul className="unassigned">{unassigned.map((c) => (
              <li key={c.id}><strong>{c.name}</strong>
                {access.canWrite && !c.contributed_by ? (
                  <ActionForm action={setConditionTeeth} className="row">
                    <input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={c.id} />
                    <input name="teeth" dir="ltr" inputMode="numeric" placeholder="13" aria-label={t(`أسنان «${c.name}»`, `Teeth for “${c.name}”`)} style={{ width: "8rem" }} required />
                    <SubmitButton className="btn sm">{t("حدد السن", "Set the tooth")}</SubmitButton>
                  </ActionForm>
                ) : <span className="muted small">{t("يحدده الطبيب الذي أضافه", "To be set by the doctor who added it")}</span>}
              </li>
            ))}</ul>
          </Card>
        )}
      <EntitySection entity={ENTITIES.conditions} pid={p.id} returnPath={base} title={t("تشخيصات الأسنان", "Dental diagnoses")} id="diagnoses"
        filter={dent ? { specialty_id: dent.id } : {}} addLabel={t("إضافة تشخيص سني", "Add a dental diagnosis")} compact
        context={{ fixed: dent ? { specialty_id: dent.id, category: "diagnosis" } : { category: "diagnosis" }, dental: true,
          suggest: { name: DENTAL_DIAGNOSES.map((d) => (lang === "ar" ? d.ar : d.en)) } }} />
      </>)}

      {tab === "treatment" && (
        <Card id="treatment" title={t("العلاج وخطط العلاج", "Treatment & treatment plans")}>
          <p className="small muted" style={{ marginBlockStart: 0 }}>{t("لكل علاج دورة: مقترح ← موافَق عليه ← مجدول ← منجز. لا يُسجَّل علاج منجزاً قبل الموافقة عليه، والجراحي يحتاج تأكيداً صريحاً. عند الإنجاز يُضاف الإجراء إلى الملف ويُحدَّث المخطط وتُغلق المشكلة التي عالجها.",
            "Each treatment moves: proposed → accepted → scheduled → completed. Nothing is completed before it was accepted, and a surgical one needs an explicit confirmation. Completing it adds the procedure, updates the chart and closes the problem it treated.")}</p>
          <TreatmentPlans plans={plans} costs={costs} catalog={catalog} problems={openProblems} actions={txActions} lang={lang} today={today} contributors={contributors}
            safety={safetyByItem} extras={(pl) => {
              const own = consentsForPlan(consents, pl.id);
              return (
                <p className="small plan-consents" data-plan-consents={pl.id}>
                  <strong>{t("الموافقات", "Consents")}:</strong>{" "}
                  {own.length === 0 ? <span className="muted">{t("لا موافقة موقّعة لهذه الخطة بعد.", "No signed consent for this plan yet.")}</span>
                    : own.map((c) => <a key={c.id} href="#consents" className={`chip ${c.status === "signed" ? "ok" : c.status === "withdrawn" ? "bad" : "muted"}`}>{c.title} · {t(`النسخة ${c.version}`, `v${c.version}`)} · {c.status === "signed" ? t("موقّعة", "signed") : c.status === "withdrawn" ? t("مسحوبة", "withdrawn") : t("مستبدلة", "superseded")}</a>)}
                </p>
              );
            }} />
        </Card>
      )}

      {tab === "treatment" && (
        <Card id="consents" title={t("الموافقات الموقّعة", "Signed consents")}>
          <p className="small muted" style={{ marginBlockStart: 0 }}>{t("يوقّع المريض أو وليّه بإصبعه أو بالفأرة، ويُحفظ نص الموافقة كما وُقّع. لا تُعدَّل ولا تُحذف: تُسحب بسبب، أو تُستبدل بنسخة جديدة.",
            "The patient or guardian signs with a finger or mouse, and the text is kept as signed. A consent is never edited or deleted: it is withdrawn with a reason, or replaced by a new version.")}</p>
          <ConsentList consents={consents as ConsentRow[]} lang={lang} tz={tz} contributors={contributors}
            actions={{
              hidden: { _pid: p.id }, withdraw: access.canWrite ? withdrawConsent : undefined,
              signatureHref: (c) => `/api/patients/${p.id}/consents/${c.id}/signature`, pdfHref: (c) => `/api/patients/${p.id}/consents/${c.id}/pdf`,
              newVersion: access.canWrite ? (c) => (
                <ConsentForm action={signConsent} hidden={{ _pid: p.id, ...(dent ? { specialty_id: dent.id } : {}) }} lang={lang} idPrefix={`cv-${c.id.slice(0, 8)}`} targets={consentTargets}
                  signerName={c.signer_name} submitLabel={t("توقيع النسخة الجديدة", "Sign the new version")}
                  supersede={{ id: c.id, kind: c.kind, title: c.title, body: (c as ConsentRow & { body: string }).body, target: c.treatment_item_id ? `item:${c.treatment_item_id}` : c.treatment_plan_id ? `plan:${c.treatment_plan_id}` : null }} />
              ) : undefined,
            }} />
          {access.canWrite && (
            <details className="fold" id="new-consent">
              <summary>{t("موافقة جديدة بالتوقيع", "A new consent to sign")}</summary>
              <div className="fold-body">
                <ConsentForm action={signConsent} hidden={{ _pid: p.id, ...(dent ? { specialty_id: dent.id } : {}) }} lang={lang} idPrefix="nc" targets={consentTargets}
                  signerName={p.full_name} submitLabel={t("توقيع وحفظ الموافقة", "Sign and save the consent")} />
              </div>
            </details>
          )}
        </Card>
      )}

      {tab === "perio" && (
        <PerioSection pid={p.id} canWrite={access.canWrite} lang={lang} today={today} q={searchParams}
          seedMissing={[...deriveChart(exams, findings).values()].filter((v) => v.status && ABSENT_STATUSES.has(v.status) && v.tooth < 50).map((v) => v.tooth)} />
      )}

      {tab === "followup" && (await (async () => {
        // recalls, and what is waiting in the dental file (open treatments, follow-ups asked at a visit, appointments)
        const [{ data: rc }, { data: dv }, { data: ap }] = await Promise.all([
          supabase.from("recalls").select("id, kind, label, interval_months, due_on, last_done_on, status, notes").eq("patient_id", p.id).eq("record_status", "active").order("due_on"),
          supabase.from("encounters").select("id, started_at, follow_up_date, reason, specialty_id").eq("patient_id", p.id).eq("record_status", "active")
            .eq("specialty_id", dent?.id ?? "").order("started_at", { ascending: false }).limit(100),
          supabase.from("appointments").select("id, scheduled_at, status, reason").eq("patient_id", p.id).eq("record_status", "active").eq("specialty_id", dent?.id ?? "")
            .eq("status", "scheduled").order("scheduled_at").limit(50),
        ]);
        const recalls = (rc ?? []) as Recall[];
        const pending = pendingFollowUps({
          today, recalls, base: `/patients/${p.id}`,
          items: openPlans.flatMap((pl) => pl.items.map((i) => ({ id: i.id, name: i.name, status: i.status, scheduled_for: i.scheduled_for, teeth: i.teeth, plan: pl.title }))),
          visits: (dv ?? []) as { id: string; started_at: string; follow_up_date: string | null; reason: string | null; specialty_id: string | null }[],
          appointments: (ap ?? []) as { id: string; scheduled_at: string; status: string; reason: string | null }[],
          label: { recall: (r) => (r.kind === "other" ? r.label ?? "" : lbl(RECALL_KIND, r.kind, lang)), acceptedNotScheduled: t("موافَق عليه ولم يُجدول", "Accepted, not scheduled"),
            inProgress: t("قيد التنفيذ", "In progress"), visitFollowUp: t("متابعة طلبتها زيارة", "Follow-up asked at a visit"), appointment: t("موعد", "Appointment"),
            appointmentPast: t("موعد مضى ولم تُحدَّث حالته", "Past appointment, status not updated") },
        });
        return (<>
          <Card id="pending" title={t("المتابعات المعلّقة", "Pending follow-ups")}>
            <PendingList items={pending} lang={lang} empty={t("لا شيء معلّق في ملف الأسنان.", "Nothing pending in the dental file.")} />
          </Card>
          <Card id="recalls" title={t("الفحص الدوري", "Recalls")}>
            <RecallList recalls={recalls} pid={p.id} specialtyId={dent?.id ?? null} canWrite={access.canWrite} lang={lang} today={today} />
          </Card>
        </>);
      })())}

      {tab === "care" && (<>
        <Card id="prescriptions" title={t("الوصفات الطبية", "Prescriptions")}>
          <p className="small muted" style={{ marginBlockStart: 0 }}>{t("الوصفة تجمع عدة أدوية بجرعتها ومدتها وكميتها؛ تُضاف الأدوية إلى الملف دفعة واحدة وتنتهي بنهاية مدتها، ويمكن طباعة الوصفة.",
            "A prescription groups several medicines with their dose, duration and quantity; the medicines are added to the file in one step and end when their duration does, and the prescription can be printed.")}</p>
          <Prescriptions rxs={prescriptions} lang={lang} tz={tz} alerts={safety}
            contributors={contributors} actions={{ hidden: { _pid: p.id }, ...(access.canWrite ? { status: setPrescriptionStatus, invalidate: invalidatePrescription } : {}),
              pdfHref: (rx) => `/api/patients/${p.id}/prescriptions/${rx.id}/pdf` }} />
          {access.canWrite && (
            <details className="fold" id="new-rx">
              <summary>{t("وصفة جديدة", "A new prescription")}</summary>
              <div className="fold-body">
                <RxForm action={createPrescription} hidden={{ _pid: p.id, ...(dent ? { specialty_id: dent.id } : {}) }} lang={lang} today={today} idPrefix="nrx" submitLabel={t("حفظ الوصفة", "Save the prescription")} />
              </div>
            </details>
          )}
        </Card>
        <EntitySection entity={ENTITIES.visits} pid={p.id} returnPath={base} title={t("زيارات الأسنان", "Dental visits")} compact
          filter={dent ? { specialty_id: dent.id } : {}} defaults={{ kind: "dental" }} context={{ fixed: dent ? { specialty_id: dent.id } : {}, dental: true }} addLabel={t("إضافة زيارة أسنان", "Add a dental visit")} />
        <EntitySection entity={ENTITIES.procedures} pid={p.id} returnPath={base} title={t("إجراءات الأسنان", "Dental procedures")} compact
          filter={dent ? { specialty_id: dent.id } : {}} defaults={{ kind: "dental" }} context={{ fixed: dent ? { specialty_id: dent.id } : {}, dental: true }} addLabel={t("إضافة إجراء سني", "Add a dental procedure")} />
        <EntitySection entity={ENTITIES.notes} pid={p.id} returnPath={base} title={t("ملاحظات طبيب الأسنان", "Dental notes")} compact
          filter={dent ? { specialty_id: dent.id } : {}} context={{ fixed: dent ? { specialty_id: dent.id } : {} }} />
        <EntitySection entity={ENTITIES.appointments} pid={p.id} returnPath={base} title={t("مواعيد الأسنان", "Dental appointments")} compact
          filter={dent ? { specialty_id: dent.id } : {}} context={{ fixed: dent ? { specialty_id: dent.id } : {} }} />
      </>)}

      {tab === "imaging" && (<>
        <EntitySection entity={ENTITIES.imaging} pid={p.id} returnPath={base} title={t("صور وأشعة الأسنان", "Dental images & X-rays")} compact
          filter={dent ? { specialty_id: dent.id } : {}} defaults={{ modality: "dental_xray" }} context={{ fixed: dent ? { specialty_id: dent.id } : {}, dental: true }} addLabel={t("إضافة صورة أو أشعة", "Add an image or X-ray")} />
        {searchParams.uploaded === "1" && <Banner tone="ok">{t("أُرفق ملف الصورة بالدراسة. افتحه من المخطط ثم «عرض».", "The image file was attached to the study. Open it from the chart, then “View”.")}</Banner>}
        {searchParams.error && <Banner tone="bad">{t("تعذر رفع الملف (JPG أو PNG أو WebP حتى 20 ميغابايت).", "The file could not be uploaded (JPG, PNG or WebP up to 20 MB).")}</Banner>}
        {access.canWrite && (imgRows ?? []).some((x) => x.specialty_id === dent?.id || (Array.isArray(x.teeth) && x.teeth.length)) && (
          <Card id="attach-image" title={t("إرفاق ملف صورة بدراسة تصوير", "Attach an image file to an imaging study")}>
            <p className="small muted" style={{ marginBlockStart: 0 }}>{t("الدراسة سجل (النوع والتاريخ والقراءة)، والملف هو الصورة نفسها. بعد الإرفاق تُفتح الصورة في العارض: تكبير وتدوير وسطوع وتباين ومقارنة وتعليقات.",
              "The study is the record (type, date, reading); the file is the picture itself. Once attached it opens in the viewer: zoom, rotate, brightness, contrast, compare and annotations.")}</p>
            <form method="post" action={`/api/patients/${p.id}/documents`} encType="multipart/form-data" className="stack" id="attach-image-form">
              <input type="hidden" name="_return" value={`${base}?tab=imaging`} /><input type="hidden" name="doc_type" value="dental_image" />
              {dent && <input type="hidden" name="specialty_id" value={dent.id} />}
              <div className="form-grid">
                <div className="field"><label htmlFor="ai_study">{t("الدراسة", "Study")}</label>
                  <select id="ai_study" name="imaging_id" required>{(imgRows ?? []).filter((x) => x.specialty_id === dent?.id || (Array.isArray(x.teeth) && x.teeth.length))
                    .map((x) => <option key={x.id} value={x.id}>{lbl(IMAGING_MODALITY, x.modality, lang)}{x.performed_on ? ` — ${fmtPartialDate(x.performed_on, x.date_precision ?? "day", lang)}` : ""}{Array.isArray(x.teeth) && x.teeth.length ? ` — ${x.teeth.join(", ")}` : ""}</option>)}</select></div>
                <div className="field"><label htmlFor="ai_file">{t("ملف الصورة (JPG / PNG / WebP)", "Image file (JPG / PNG / WebP)")}</label>
                  <input id="ai_file" name="file" type="file" required accept="image/jpeg,image/png,image/webp" /></div>
                <div className="field"><label htmlFor="ai_title">{t("العنوان", "Title")}</label><input id="ai_title" name="title" maxLength={200} /></div>
              </div>
              <div><button className="btn primary">{t("إرفاق الصورة", "Attach the image")}</button></div>
            </form>
          </Card>
        )}
        <p className="small"><Link href={`/patients/${p.id}/documents${dent ? `?specialty=${dent.id}` : ""}`}>{t("ملفات الصور والتقارير (المستندات) ←", "Image files and reports (documents) →")}</Link></p>
      </>)}

      {tab === "profile" && (<>

      <Card id="profile" title={t("الملف السني", "Dental profile")}>
        {access.canWrite ? (
          <ActionForm action={saveDentalProfile} className="stack" resetOnSuccess={false}>
            <input type="hidden" name="_pid" value={p.id} />
            <div className="form-grid">
              <Select name="dentition" label={t("نوع الإطباق المعروض", "Dentition shown")} opts={DENTITION} value={(pr?.dentition as string) ?? dentition} lang={lang} />
              <Select name="brushing" label={t("تفريش الأسنان", "Tooth brushing")} opts={BRUSHING} value={pr?.brushing as string} lang={lang} blank />
              <Select name="flossing" label={t("خيط الأسنان", "Flossing")} opts={FLOSSING} value={pr?.flossing as string} lang={lang} blank />
              <YesNo name="bruxism" label={t("صرير / شدّ الأسنان", "Teeth grinding / clenching")} value={yn(pr?.bruxism)} lang={lang} />
              <YesNo name="dry_mouth" label={t("جفاف الفم", "Dry mouth")} value={yn(pr?.dry_mouth)} lang={lang} />
              <Select name="dental_anxiety" label={t("القلق من علاج الأسنان", "Dental anxiety")} opts={ANXIETY} value={pr?.dental_anxiety as string} lang={lang} blank />
              <div className="field"><label htmlFor="dp_lv">{t("آخر زيارة لطبيب الأسنان", "Last dental visit")}</label><input id="dp_lv" name="last_visit_on" type="date" defaultValue={(pr?.last_visit_on as string) ?? ""} max={today} /></div>
              <div className="field"><label htmlFor="dp_lc">{t("آخر تنظيف (تقليح)", "Last cleaning (scaling)")}</label><input id="dp_lc" name="last_cleaning_on" type="date" defaultValue={(pr?.last_cleaning_on as string) ?? ""} max={today} /></div>
              <div className="field wide"><label htmlFor="dp_or">{t("تقويم سابق أو حالي", "Past or current orthodontics")}</label><input id="dp_or" name="orthodontic_history" maxLength={1000} defaultValue={(pr?.orthodontic_history as string) ?? ""} /></div>
              <div className="field wide"><label htmlFor="dp_n">{t("ملاحظات", "Notes")}</label><textarea id="dp_n" name="notes" rows={2} maxLength={2000} defaultValue={(pr?.notes as string) ?? ""} /></div>
            </div>
            <div><SubmitButton>{t("حفظ الملف السني", "Save the dental profile")}</SubmitButton></div>
          </ActionForm>
        ) : !pr ? <Empty>{t("لم يُعبأ بعد.", "Not filled in yet.")}</Empty> : (
          <dl className="kv">
            <dt>{t("التفريش", "Brushing")}</dt><dd>{lbl(BRUSHING, pr.brushing as string, lang) || "—"}</dd>
            <dt>{t("الخيط", "Flossing")}</dt><dd>{lbl(FLOSSING, pr.flossing as string, lang) || "—"}</dd>
            <dt>{t("آخر زيارة", "Last visit")}</dt><dd>{(pr.last_visit_on as string) ?? "—"}</dd>
          </dl>
        )}
      </Card>
      </>)}
    </>
  );
}

function Select({ name, label, opts, value, lang, blank }: { name: string; label: string; opts: { value: string; ar: string; en: string }[]; value?: string | null; lang: "ar" | "en"; blank?: boolean }) {
  return (
    <div className="field"><label htmlFor={`dp_${name}`}>{label}</label>
      <select id={`dp_${name}`} name={name} defaultValue={value ?? ""}>{blank && <option value="">—</option>}{opts.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
  );
}
function YesNo({ name, label, value, lang }: { name: string; label: string; value: string; lang: "ar" | "en" }) {
  const ar = lang === "ar";
  return (
    <div className="field"><label htmlFor={`dp_${name}`}>{label}</label>
      <select id={`dp_${name}`} name={name} defaultValue={value}><option value="">{ar ? "غير محدد" : "Not stated"}</option><option value="yes">{ar ? "نعم" : "Yes"}</option><option value="no">{ar ? "لا" : "No"}</option></select></div>
  );
}
