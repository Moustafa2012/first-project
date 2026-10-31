import Link from "next/link";
import { Share2, Stethoscope } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient, getSpecialties } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtPartialDate, localDate } from "@/lib/format";
import { ENTITIES } from "@/lib/entities";
import { SOURCE, lbl } from "@/lib/labels";
import {
  ANXIETY, BRUSHING, DENTITION, EXAM_KIND, FINDING_KIND, FLOSSING, ORAL_HYGIENE, TOOTH_STATUS, chartDentition, compareExams, fmtSurfaces,
  type ExamRow, type FindingRow,
} from "@/lib/dental";
import { Card, Chip, Empty, PageHead } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { EntitySection } from "@/components/EntitySection";
import { DentalChart, type DentalDiagnosis } from "@/components/dental/DentalChart";
import { ExamEditor } from "@/components/dental/ExamEditor";
import { ClinicalContext } from "@/components/ClinicalContext";
import { getClinicalContext } from "@/lib/clinical-context-server";
import { invalidateDental, saveDentalExam, saveDentalProfile } from "@/app/actions/dental";

type Profile = Record<string, string | boolean | null>;

export default async function DentalPage({ params, searchParams }: { params: { pid: string }; searchParams: { asof?: string; a?: string; b?: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const [access, specs, ctx] = await Promise.all([getAccess(p.id), getSpecialties(), getClinicalContext(p.id)]);
  const dent = specs.find((s) => s.code === "dentistry");
  const supabase = createClient();
  const [{ data: profile }, { data: examRows }, { data: stateRows }, { data: findingRows }, { data: condRows }, { data: ctrRows }] = await Promise.all([
    supabase.from("dental_profiles").select("*").eq("patient_id", p.id).maybeSingle(),
    supabase.from("dental_exams").select("*").eq("patient_id", p.id).eq("record_status", "active").order("exam_date", { ascending: false }),
    supabase.from("dental_tooth_states").select("exam_id, tooth, status, note").eq("patient_id", p.id),
    supabase.from("dental_findings").select("*").eq("patient_id", p.id).eq("record_status", "active").order("observed_on", { ascending: false }),
    supabase.from("conditions").select("id, name, teeth, certainty, clinical_status, contributed_by").eq("patient_id", p.id).eq("record_status", "active"),
    supabase.from("share_contributors").select("id, full_name").eq("patient_id", p.id),
  ]);
  const exams: ExamRow[] = (examRows ?? []).map((e) => ({ ...e, states: (stateRows ?? []).filter((s) => s.exam_id === e.id) })) as ExamRow[];
  const findings = (findingRows ?? []) as FindingRow[];
  const diagnoses = ((condRows ?? []) as DentalDiagnosis[]).filter((c) => Array.isArray(c.teeth) && c.teeth.length > 0);
  const contributors = Object.fromEntries((ctrRows ?? []).map((c) => [c.id as string, c.full_name as string]));
  const pr = (profile ?? null) as Profile | null;
  const dentition = chartDentition(pr as { dentition?: string } | null, exams);
  const today = localDate(new Date(), tz);
  const asExam = exams.find((e) => e.id === searchParams.asof);
  const ea = exams.find((e) => e.id === searchParams.a), eb = exams.find((e) => e.id === searchParams.b);
  const changes = ea && eb && ea.id !== eb.id ? compareExams(ea, eb, findings) : null;
  const base = `/patients/${p.id}/dental`;
  const examLabel = (e: ExamRow) => `${fmtPartialDate(e.exam_date, "day", lang)} — ${lbl(EXAM_KIND, e.kind, lang)}${e.examiner_name ? ` — ${e.examiner_name}` : ""}`;
  const day = (v: string) => fmtPartialDate(v, "day", lang);
  const yn = (v: unknown) => (v === true ? "yes" : v === false ? "no" : "");

  return (
    <>
      <PageHead
        title={t("ملف الأسنان", "Dental file")}
        sub={t("مخطط الأسنان والفحوص والموجودات على كل سن وسطح، مع تاريخ كامل لا يُمسح.", "Tooth chart, exams and findings per tooth and surface, with a history that is never overwritten.")}
        actions={<>
          {dent && <Link className="btn" href={`/patients/${p.id}/specialties/dentistry`}><Stethoscope size={16} aria-hidden="true" />{t("زيارات وإجراءات الأسنان", "Dental visits & procedures")}</Link>}
          {access.canShare && <Link className="btn primary" href={`/patients/${p.id}/sharing/new?specialty=dentistry`}><Share2 size={16} aria-hidden="true" />{t("شارك مع طبيب الأسنان", "Share with the dentist")}</Link>}
        </>}
      />

      <ClinicalContext ctx={ctx} lang={lang} tz={tz} codes={["dentistry"]} coreHref={`/patients/${p.id}/profile`} />

      <Card id="chart" title={asExam ? t(`المخطط كما كان في ${day(asExam.exam_date)}`, `The chart as of ${day(asExam.exam_date)}`) : t("مخطط الأسنان الحالي", "Current tooth chart")}
        actions={exams.length > 0 ? (
          <form method="get" action={`${base}#chart`} className="row">
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
          pid={p.id} canWrite={access.canWrite} today={today} asOf={asExam?.exam_date ?? null} specialtyId={dent?.id ?? null} />
      </Card>

      {access.canWrite && (
        <Card id="new-exam" title={t("تسجيل فحص أسنان", "Record a dental exam")}>
          <details className="fold">
            <summary>{t("فحص جديد على المخطط", "New exam on the chart")}</summary>
            <div className="fold-body">
              <p className="small muted">{t("ما تسجله أنت يظهر «إفادة غير موثقة» حتى يؤكده طبيب. اختر «إفادة المريض» نوعاً للفحص إن لم يكن فحصاً سريرياً.",
                "What you record shows as “unverified” until a clinician confirms it. Choose “Patient's own account” as the kind if it was not a clinical exam.")}</p>
              <ExamEditor action={saveDentalExam} hidden={{ _pid: p.id }} lang={lang} today={today} defaultDentition={dentition}
                conditions={diagnoses.map((d) => ({ id: d.id, name: d.name, teeth: d.teeth }))} idPrefix="px" evidenceDefault="patient_reported" />
            </div>
          </details>
        </Card>
      )}

      <Card id="exams" title={t(`الفحوص (${exams.length})`, `Exams (${exams.length})`)}>
        {exams.length === 0 ? <Empty>{t("لا فحوص بعد.", "No exams yet.")}</Empty> : (
          <>
            {exams.length > 1 && (
              <form method="get" action={`${base}#compare`} className="row compare-form">
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
                      {e.contributed_by ? <Chip tone="info">{t(`أضافه ${contributors[e.contributed_by] ?? "طبيب"} عبر رابط`, `Added by ${contributors[e.contributed_by] ?? "a doctor"} via a link`)}</Chip>
                        : e.verification === "reported" ? <Chip tone="muted">{t("إفادة غير موثقة", "Unverified (reported)")}</Chip> : <Chip tone="ok">{t("موثّق", "Confirmed")}</Chip>}
                      <Chip tone="muted">{lbl(SOURCE, e.source, lang)}</Chip></span>
                    <Link className="btn sm" href={`${base}?asof=${e.id}#chart`}>{t("المخطط في هذا التاريخ", "Chart at this date")}</Link>
                  </div>
                  <p className="small muted">{[e.examiner_name, e.facility_name, e.oral_hygiene && `${t("نظافة الفم", "Oral hygiene")}: ${lbl(ORAL_HYGIENE, e.oral_hygiene, lang)}`].filter(Boolean).join(" · ")}
                    {" · "}{t(`${e.states.length} سن · ${fs.length} موجود`, `${e.states.length} teeth · ${fs.length} findings`)}</p>
                  {e.chief_complaint && <p className="small">{t("الشكوى", "Complaint")}: {e.chief_complaint}</p>}
                  {fs.length > 0 && <p className="small">{fs.map((f) => `${f.tooth}${f.surfaces.length ? " " + fmtSurfaces(f.surfaces, f.tooth) : ""} ${lbl(FINDING_KIND, f.kind, lang)}`).join(" · ")}</p>}
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

      <EntitySection entity={ENTITIES.conditions} pid={p.id} returnPath={base} title={t("تشخيصات الأسنان", "Dental diagnoses")}
        filter={dent ? { specialty_id: dent.id } : {}} defaults={dent ? { specialty_id: dent.id, category: "diagnosis" } : {}} compact />

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
