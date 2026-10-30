"use client";

import { useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import {
  DISEASE_KINDS, EVIDENCE, FINDING_KIND, FINDING_SEVERITY, MATERIAL, SURFACES, TOOTH_STATUS, WHOLE_TOOTH_KINDS, chartSummary, deriveChart,
  fmtSurfaces, surfaceCode, surfaceName, toothName, type Dentition, type ExamRow, type FindingRow,
} from "@/lib/dental";
import { CERTAINTY, CLINICAL_STATUS, DATE_PRECISION, lbl } from "@/lib/labels";
import { fmtPartialDate } from "@/lib/format";
import { Chip } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { addDentalFinding, invalidateDental, resolveDentalFinding } from "@/app/actions/dental";
import { Odontogram, OdontoLegend, type ChartTooth } from "./Odontogram";

export interface DentalDiagnosis { id: string; name: string; teeth: number[] | null; certainty?: string | null; clinical_status?: string | null; contributed_by?: string | null }

/** The current chart (or the chart as it was on a past date), with a panel for the chosen tooth. */
export function DentalChart({
  dentition, exams, findings, diagnoses, contributors, lang, pid, canWrite, today, asOf, specialtyId,
}: {
  dentition: Dentition; exams: ExamRow[]; findings: FindingRow[]; diagnoses: DentalDiagnosis[]; contributors: Record<string, string>;
  lang: Lang; pid?: string; canWrite: boolean; today: string; asOf?: string | null; specialtyId?: string | null;
}) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const chart = useMemo(() => deriveChart(exams, findings, asOf ?? undefined), [exams, findings, asOf]);
  const teeth = useMemo(() => Object.fromEntries([...chart].map(([k, v]) => [k, { status: v.status, findings: v.findings } as ChartTooth])), [chart]);
  const [sel, setSel] = useState<number | null>(null);
  const sum = chartSummary(chart);
  const v = sel ? chart.get(sel) : undefined;
  const history = sel ? findings.filter((f) => f.tooth === sel).sort((a, b) => b.observed_on.localeCompare(a.observed_on)) : [];
  const stateHistory = sel ? exams.flatMap((e) => e.states.filter((s) => s.tooth === sel).map((s) => ({ ...s, date: e.exam_date, exam: e })))
    .sort((a, b) => b.date.localeCompare(a.date)) : [];
  const dx = sel ? diagnoses.filter((d) => d.teeth?.includes(sel)) : [];
  const examOf = (id: string | null) => exams.find((e) => e.id === id);

  const prov = (r: { contributed_by?: string | null; verification?: string | null; source_detail?: string | null }) =>
    r.contributed_by ? <Chip tone="info">{t(`أضافه ${contributors[r.contributed_by] ?? "طبيب"} عبر رابط`, `Added by ${contributors[r.contributed_by] ?? "a doctor"} via a link`)}</Chip>
      : r.verification === "reported" ? <Chip tone="muted">{t("إفادة غير موثقة", "Unverified (reported)")}</Chip>
        : <Chip tone="ok">{t("موثّق", "Confirmed")}</Chip>;

  const findingLine = (f: FindingRow, tooth: number) => (
    <>
      <strong>{lbl(FINDING_KIND, f.kind, lang)}</strong>
      {f.surfaces.length > 0 && <>{" "}<span className="ltr">{fmtSurfaces(f.surfaces, tooth)}</span></>}
      {f.material && <span> · {lbl(MATERIAL, f.material, lang)}</span>}
      {f.severity && <span> · {lbl(FINDING_SEVERITY, f.severity, lang)}</span>}
      <span className="muted small"> · {fmtPartialDate(f.observed_on, f.date_precision ?? "day", lang)} · {lbl(EVIDENCE, f.evidence, lang)}</span>
    </>
  );

  return (
    <div className="dental-chart">
      <Odontogram dentition={dentition} teeth={teeth} lang={lang} selected={sel} onSelect={setSel} idPrefix="chart" />
      <p className="small muted">
        {t(`أسنان لها بيانات فحص: ${sum.examined} · مفقودة/مخلوعة: ${sum.absent} · بها مشكلة: ${sum.disease} · بها علاج موجود: ${sum.work}`,
          `Teeth with exam data: ${sum.examined} · missing/extracted: ${sum.absent} · with a problem: ${sum.disease} · with existing work: ${sum.work}`)}
      </p>
      <OdontoLegend lang={lang} />

      {!sel ? <p className="hint">{t("اختر سناً لعرض تفاصيله وتاريخه.", "Choose a tooth to see its details and history.")}</p> : (
        <section className="tooth-panel" aria-live="polite" aria-label={t(`السن ${sel}`, `Tooth ${sel}`)}>
          <div className="row between">
            <h3><span className="ltr">{sel}</span> — {toothName(sel, lang)}</h3>
            <button type="button" className="btn ghost sm" onClick={() => setSel(null)}>{t("إغلاق", "Close")}</button>
          </div>
          <p>
            {v?.status ? <>{t("الحالة", "State")}: <strong>{lbl(TOOTH_STATUS, v.status, lang)}</strong>
              <span className="muted small"> — {t("آخر فحص", "last exam")} {v.statusDate}</span></>
              : <span className="muted">{t("لا يوجد فحص سجّل حالة هذا السن (لا يعني أنه سليم).", "No exam recorded this tooth's state (not the same as healthy).")}</span>}
          </p>

          <h4>{asOf ? t(`الموجود حتى ${asOf}`, `Present as of ${asOf}`) : t("الموجود حالياً", "Current")}</h4>
          {(v?.findings ?? []).length === 0 ? <p className="muted small">{t("لا شيء مسجل.", "Nothing recorded.")}</p> : (
            <ul className="tooth-list">
              {v!.findings.map((f) => (
                <li key={f.id} className={DISEASE_KINDS.has(f.kind) ? "disease" : "work"}>
                  <div>{findingLine(f, sel)} {prov(f)}</div>
                  {f.notes && <div className="small">{f.notes}</div>}
                  {canWrite && pid && !asOf && (
                    <div className="row" style={{ gap: ".4rem" }}>
                      <details className="fold"><summary>{t("عولج / انتهى", "Treated / resolved")}</summary><div className="fold-body">
                        <ActionForm action={resolveDentalFinding} className="row">
                          <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={f.id} />
                          <input type="date" name="resolved_on" required defaultValue={today} max={today} aria-label={t("التاريخ", "Date")} />
                          <input name="resolved_note" maxLength={500} placeholder={t("كيف؟ (مثلاً: حُشي في عيادة…)", "How? (e.g. filled at…)")} aria-label={t("ملاحظة", "Note")} style={{ flex: 1, minWidth: 160 }} />
                          <SubmitButton className="btn sm">{t("حفظ", "Save")}</SubmitButton>
                        </ActionForm></div></details>
                      {!f.contributed_by && (
                        <details className="fold"><summary>{t("أُدخل خطأً", "Entered in error")}</summary><div className="fold-body">
                          <ActionForm action={invalidateDental} className="row">
                            <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={f.id} /><input type="hidden" name="_table" value="dental_findings" />
                            <input name="reason" required minLength={3} maxLength={400} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 160 }} />
                            <ConfirmButton message={t("إبطال هذا الموجود؟ يبقى في التاريخ مع السبب.", "Invalidate this finding? It stays in the history with the reason.")}>{t("إبطال", "Invalidate")}</ConfirmButton>
                          </ActionForm></div></details>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {dx.length > 0 && (<>
            <h4>{t("تشخيصات تخص هذا السن", "Diagnoses naming this tooth")}</h4>
            <ul className="tooth-list">{dx.map((d) => (
              <li key={d.id}><strong>{d.name}</strong> <Chip tone="muted">{lbl(CLINICAL_STATUS, d.clinical_status, lang)}</Chip> <Chip tone={d.certainty === "confirmed" ? "ok" : "muted"}>{lbl(CERTAINTY, d.certainty, lang)}</Chip>
                {d.contributed_by && <Chip tone="info">{t("أضافه طبيب عبر رابط", "Added by a doctor via a link")}</Chip>}</li>
            ))}</ul>
          </>)}

          <h4>{t("تاريخ السن", "Tooth history")}</h4>
          {history.length === 0 && stateHistory.length === 0 ? <p className="muted small">{t("لا تاريخ مسجل.", "No history recorded.")}</p> : (
            <ol className="tooth-hist">
              {[...history.map((f) => ({ key: `f${f.id}`, date: f.observed_on, node: (
                <>{findingLine(f, sel)}{f.resolved_on && <Chip tone="ok">{t(`عولج ${f.resolved_on}`, `resolved ${f.resolved_on}`)}{f.resolved_note ? ` — ${f.resolved_note}` : ""}</Chip>}
                  {f.exam_id && examOf(f.exam_id)?.examiner_name && <span className="muted small"> · {examOf(f.exam_id)!.examiner_name}</span>}</>
              ) })),
              ...stateHistory.map((s) => ({ key: `s${s.exam.id}`, date: s.date, node: (
                <>{t("الحالة", "State")}: <strong>{lbl(TOOTH_STATUS, s.status, lang)}</strong>{s.note && ` — ${s.note}`}
                  <span className="muted small"> · {s.date}{s.exam.examiner_name ? ` · ${s.exam.examiner_name}` : ""}</span></>
              ) }))].sort((a, b) => b.date.localeCompare(a.date)).map((x) => <li key={x.key}>{x.node}</li>)}
            </ol>
          )}

          {canWrite && pid && !asOf && (
            <details className="fold"><summary>{t("أضف إلى هذا السن (خارج فحص)", "Add to this tooth (outside an exam)")}</summary>
              <div className="fold-body">
                <AddFinding pid={pid} tooth={sel} lang={lang} today={today} specialtyId={specialtyId ?? ""} />
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function AddFinding({ pid, tooth, lang, today, specialtyId }: { pid: string; tooth: number; lang: Lang; today: string; specialtyId: string }) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const [kind, setKind] = useState("filling");
  const whole = WHOLE_TOOTH_KINDS.has(kind);
  return (
    <ActionForm action={addDentalFinding} className="stack" id={`add-finding-${tooth}`}>
      <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="tooth" value={tooth} /><input type="hidden" name="_spec" value={specialtyId} />
      <div className="form-grid">
        <div className="field"><label htmlFor={`af_kind_${tooth}`}>{t("ما الموجود", "What")}</label>
          <select id={`af_kind_${tooth}`} name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{FINDING_KIND.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
        <div className="field"><label htmlFor={`af_ev_${tooth}`}>{t("المصدر / الإثبات", "Evidence")}</label>
          <select id={`af_ev_${tooth}`} name="evidence" defaultValue="patient_reported">{EVIDENCE.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
        {DISEASE_KINDS.has(kind)
          ? <div className="field"><label htmlFor={`af_sev_${tooth}`}>{t("الشدة", "Severity")}</label><select id={`af_sev_${tooth}`} name="severity" defaultValue=""><option value="">—</option>{FINDING_SEVERITY.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
          : <div className="field"><label htmlFor={`af_mat_${tooth}`}>{t("المادة", "Material")}</label><select id={`af_mat_${tooth}`} name="material" defaultValue=""><option value="">—</option>{MATERIAL.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>}
        <div className="field"><label htmlFor={`af_date_${tooth}`}>{t("منذ / بتاريخ", "Since / on")} <span className="req">*</span></label>
          <div className="date-prec"><input id={`af_date_${tooth}`} name="observed_on" type="date" required max={today} />
            <select name="date_precision" defaultValue="year" aria-label={t("دقة التاريخ", "Date precision")}>{DATE_PRECISION.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div></div>
        {!whole && (
          <fieldset className="field wide surf-pick"><legend>{t("الأسطح (إن عُرفت)", "Surfaces (if known)")}</legend>
            {SURFACES.map((s) => <label key={s} className="pill"><input type="checkbox" name="surfaces" value={s} /><span className="ltr">{surfaceCode(s, tooth)}</span> {surfaceName(s, tooth, lang)}</label>)}
          </fieldset>
        )}
        <div className="field wide"><label htmlFor={`af_notes_${tooth}`}>{t("ملاحظة", "Note")}</label><input id={`af_notes_${tooth}`} name="notes" maxLength={2000} /></div>
      </div>
      <div><SubmitButton>{t("إضافة", "Add")}</SubmitButton></div>
    </ActionForm>
  );
}
