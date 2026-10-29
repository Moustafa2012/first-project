import { TriangleAlert, ShieldCheck, CircleHelp, FileText, LogOut, Printer } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtPartialDate } from "@/lib/format";
import { ALLERGY_SEVERITY, CERTAINTY, CLINICAL_STATUS, CONDITION_CATEGORY, DOC_TYPE, ENCOUNTER_KIND, IMAGING_MODALITY, lbl, MED_ORIGIN, PROCEDURE_KIND, SEX, SHARE_MODULES, FAMILY_RELATION, CARE_PLAN_STATUS, LAB_GROUP, IMMUNIZATION_STATUS } from "@/lib/labels";
import { buildSeries, stats } from "@/lib/clinical/series";
import { REF_LINES } from "@/lib/clinical/refs";
import type { Bundle } from "@/lib/share-types";
import type { ObservationRow, ObservationType } from "@/lib/types";
import { Banner, Card, Chip, Empty, InterpChip, KV } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { TrendChart } from "@/components/observations/TrendChart";
import { endShare, addShareNote } from "@/app/actions/share-viewer";

type R = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export function ShareViewer({ b, token }: { b: Bundle; token: string }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const inc = new Set(b.meta.include);
  const spec = (id: unknown) => { const x = b.specialties.find((y) => y.id === id); return x ? (lang === "ar" ? x.name_ar : x.name_en) : ""; };
  const d = (v: unknown, prec?: unknown) => (prec ? fmtPartialDate(s(v), prec, lang, tz) : fmtDate(s(v), lang, tz));
  const dt = (v: unknown) => fmtDateTime(s(v), lang, tz);
  const p = b.patient;
  const obs = (b.observations ?? []) as R[];

  // charts per observation type with 2+ numeric points
  const byType = new Map<string, R[]>();
  for (const o of obs) byType.set(s(o.type_code), [...(byType.get(s(o.type_code)) ?? []), o]);
  const types = Array.from(byType.entries()).map(([code, list]) => {
    const f = list[0];
    const ty = { code, value_kind: f.value_kind, name_ar: f.name_ar, name_en: f.name_en, default_unit: s(f.unit) || null, decimals: 1 } as unknown as ObservationType;
    const rows = list.map((o) => ({ ...o, id: o.id, status: o.status, interpretation: o.interpretation, unit: o.unit, type_id: code } as unknown as ObservationRow));
    return { code, ty, list, series: buildSeries(ty, rows), cat: s(f.category), group: s(f.lab_group) };
  });

  return (
    <div className="stack">
      {!b.meta.allow_print && <style>{`@media print { body * { display: none !important; } }`}</style>}
      <div className="row between no-print">
        <div className="muted small">{t("جلسة محدودة المدة — انتهاء المشاركة", "Time-limited session — share expires")}: <strong>{dt(b.meta.expires_at)}</strong></div>
        <div className="row">
          {b.meta.allow_print ? <a className="btn sm" href={`/s/${token}/pdf`} target="_blank" rel="noopener noreferrer"><Printer size={14} aria-hidden="true" />{t("طباعة (PDF)", "Print (PDF)")}</a> : <Chip tone="muted">{t("الطباعة غير مسموحة", "Printing not allowed")}</Chip>}
          <form action={endShare}><input type="hidden" name="_t" value={token} /><button className="btn sm"><LogOut size={14} aria-hidden="true" />{t("إنهاء الجلسة", "End session")}</button></form>
        </div>
      </div>

      <section className="card">
        <div className="row between">
          <div><h1 style={{ marginBottom: ".1rem" }}>{lang === "en" && p.full_name_en ? p.full_name_en : p.full_name}</h1>
            <p className="muted" style={{ margin: 0 }}><span className="ltr">{p.mrn}</span> · {p.age_years} {t("سنة", "y")} · {lbl(SEX, p.sex, lang)} · {t("الميلاد", "DOB")} {d(p.date_of_birth)}{p.nationality ? ` · ${p.nationality}` : ""}</p></div>
          <div className="row">{p.blood_group ? <Chip tone="info">{t("الدم", "Blood")}: <span className="ltr">{p.blood_group}</span>{p.blood_group_verified ? "" : ` (${t("غير موثقة", "unverified")})`}</Chip> : <Chip tone="muted">{t("فصيلة الدم غير مسجلة", "Blood group not recorded")}</Chip>}
            {p.phone && <Chip tone="muted"><span className="ltr">{p.phone}</span></Chip>}</div>
        </div>
        <p style={{ marginBlockStart: ".6rem", marginBlockEnd: 0 }}><strong>{t("الغرض", "Purpose")}:</strong> {b.meta.title}{b.meta.recipient_label ? ` — ${b.meta.recipient_label}` : ""}</p>
        <p className="small muted" style={{ margin: 0 }}>
          {t("النطاق", "Scope")}: {b.meta.scope_kind === "specialty" ? b.meta.specialties.map((x) => (lang === "ar" ? x.name_ar : x.name_en)).join("، ") : b.meta.scope_kind === "full" ? t("الملف الكامل", "Whole file") : t("سجلات مختارة", "Selected records")}
          {b.meta.date_from || b.meta.date_to ? ` · ${b.meta.date_from ?? "…"} → ${b.meta.date_to ?? "…"}` : ""}
          {" · "}{t("يتضمن", "includes")}: {b.meta.include.map((m) => SHARE_MODULES.find((x) => x.value === m)?.[lang]).filter(Boolean).join("، ") || t("الأساسيات فقط", "essentials only")}
        </p>
      </section>

      <section className="card" aria-label={t("معلومات السلامة", "Safety information")}>
        <h2>{t("معلومات السلامة", "Safety information")}</h2>
        {b.allergies.length > 0 ? (
          <div className="banner bad" role="alert"><TriangleAlert size={18} aria-hidden="true" style={{ flex: "none", marginBlockStart: 3 }} />
            <div><strong>{t("حساسية موثقة", "Documented allergies")}:</strong> {b.allergies.map((a, i) => <span key={i}>{i ? "، " : ""}{s(a.substance)} — {lbl(ALLERGY_SEVERITY, s(a.severity), lang)}{a.reaction ? ` (${s(a.reaction)})` : ""}</span>)}</div></div>
        ) : b.allergy_assertion === "none_known" ? <div className="banner ok"><ShieldCheck size={18} aria-hidden="true" /><div>{t("لا توجد حساسية معروفة (إقرار المريض).", "No known allergies (patient’s statement).")}</div></div>
          : <div className="banner warn"><CircleHelp size={18} aria-hidden="true" /><div><strong>{t("حالة الحساسية غير معروفة", "Allergy status unknown")}</strong> — {t("لم يُسجَّل شيء؛ لا يعني ذلك غياب الحساسية.", "nothing recorded; this does not mean none exist.")}</div></div>}
        <div className="grid cols-2" style={{ marginBlockStart: ".9rem" }}>
          <div><h3>{t("الأمراض المزمنة والعيوب الخلقية", "Chronic & congenital conditions")}</h3>
            {b.chronic_conditions.length === 0 ? <p className="muted small">{t("لا شيء مسجل (لا يعني عدم وجود).", "None recorded (not proof of none).")}</p> : b.chronic_conditions.map((c, i) => (
              <div key={i}><strong>{s(c.name)}</strong> <Chip tone={c.certainty === "confirmed" ? "ok" : "muted"}>{lbl(CERTAINTY, s(c.certainty), lang)}</Chip> <span className="muted small">{lbl(CONDITION_CATEGORY, s(c.category), lang)} · {lbl(CLINICAL_STATUS, s(c.clinical_status), lang)}{c.onset_date ? ` · ${d(c.onset_date, c.date_precision)}` : ""}</span></div>))}</div>
          <div><h3>{t("الأدوية الحالية", "Current medications")}</h3>
            {b.medications.length === 0 ? <p className="muted small">{t("لا شيء مسجل (لا يعني عدم تناول أدوية).", "None recorded (not proof none are taken).")}</p> : b.medications.map((m, i) => (
              <div key={i}><strong>{[s(m.name_generic), m.name_brand && `(${s(m.name_brand)})`, s(m.strength)].filter(Boolean).join(" ")}</strong> <span className="muted small">{[s(m.dose), s(m.frequency), s(m.route)].filter(Boolean).join(" · ")} · {lbl(MED_ORIGIN, s(m.origin), lang)}{m.indication ? ` · ${s(m.indication)}` : ""}</span></div>))}</div>
        </div>
      </section>

      {inc.has("contact") && (b.emergency_contacts ?? []).length > 0 && (
        <Card title={t("جهات الطوارئ", "Emergency contacts")}>{(b.emergency_contacts ?? []).map((c, i) => <div key={i}>{s(c.full_name)} {c.relation ? `(${s(c.relation)})` : ""} <span className="ltr">{s(c.phone)}</span></div>)}</Card>
      )}

      {inc.has("observations") && (
        <Card title={t("القياسات والتحاليل عبر الزمن", "Measurements & lab results over time")}>
          {obs.length === 0 ? <Empty>{t("لا توجد قياسات ضمن النطاق.", "No measurements in scope.")}</Empty> : (
            <>
              <Banner tone="info">{t("التصنيفات مؤشرات فحص عامة أو من المختبر وليست تشخيصاً. الوحدات والمجالات المرجعية كما سُجّلت.", "Flags are general screening prompts or lab flags, not a diagnosis. Units and reference ranges are as recorded.")}</Banner>
              <div className="table-wrap" style={{ marginBlockStart: ".6rem" }}><table className="t">
                <thead><tr><th>{t("القياس", "Measure")}</th><th>{t("آخر قيمة", "Latest")}</th><th>{t("التاريخ", "Date")}</th><th>{t("المرجع", "Ref.")}</th><th>{t("التصنيف", "Flag")}</th><th>{t("العدد", "n")}</th></tr></thead>
                <tbody>{types.sort((a, b2) => a.cat.localeCompare(b2.cat) || a.group.localeCompare(b2.group)).map(({ code, list }) => {
                  const l = list[0];
                  const ref = l.ref_low != null || l.ref_high != null ? `${s(l.ref_low)} – ${s(l.ref_high)}` : s(l.ref_text);
                  return (<tr key={code}><td>{l.custom_name ? s(l.custom_name) : s(lang === "ar" ? l.name_ar : l.name_en)}{l.lab_group ? <div className="muted small">{LAB_GROUP[s(l.lab_group)]?.[lang]}</div> : null}</td>
                    <td className="nowrap"><strong className="ltr">{l.value_kind === "bp" ? `${s(l.value_num)}/${s(l.value_num2)}` : s(l.value_num ?? l.value_text)}</strong> <span className="muted small ltr">{s(l.unit)}</span></td>
                    <td className="nowrap">{dt(l.effective_at)}</td><td className="muted small nowrap"><span className="ltr">{ref}</span></td><td><InterpChip value={s(l.interpretation)} lang={lang} />{l.is_correction ? <div className="muted small">{t("نتيجة مصحَّحة", "corrected result")}</div> : null}</td><td>{list.length}</td></tr>);
                })}</tbody></table></div>
              {types.filter((x) => x.series.some((sr) => sr.pts.length >= 2)).map(({ code, ty, series }) => {
                const units = new Set(series.map((x) => x.unit));
                return (
                  <details className="fold" key={code} style={{ marginBlockStart: ".6rem" }}>
                    <summary>{lang === "ar" ? s(ty.name_ar) : s(ty.name_en)} — {t("الرسم الزمني", "trend")}</summary>
                    <div className="fold-body">
                      {units.size > 1 && <Banner tone="warn">{t("وحدات مختلفة: تُعرض منفصلة ولا تُقارن.", "Different units: drawn separately, not compared.")}</Banner>}
                      <TrendChart series={series} lang={lang} tz={tz} refLines={units.size === 1 ? REF_LINES[code] : undefined} name={lang === "ar" ? s(ty.name_ar) : s(ty.name_en)} tableLabel={t("عرض القيم كجدول", "Show values as a table")} />
                      {series.filter((x) => x.pts.length).slice(0, 1).map((x) => { const st = stats(x.pts)!; return <p key={x.key} className="small muted">{t("المتوسط", "mean")} {Number(st.mean.toFixed(1))} · {t("أدنى", "min")} {st.min} · {t("أعلى", "max")} {st.max} · {st.count} {t("قراءة", "readings")}</p>; })}
                    </div>
                  </details>);
              })}
              <details className="fold" style={{ marginBlockStart: ".6rem" }}><summary>{t("كل النتائج (السجل الكامل ضمن النطاق)", "All results (full history in scope)")}</summary>
                <div className="fold-body table-wrap"><table className="t"><tbody>{obs.map((o, i) => (
                  <tr key={i}><td className="nowrap">{dt(o.effective_at)}</td><td>{o.custom_name ? s(o.custom_name) : s(lang === "ar" ? o.name_ar : o.name_en)}</td>
                    <td className="nowrap"><span className="ltr">{o.value_kind === "bp" ? `${s(o.value_num)}/${s(o.value_num2)}` : s(o.value_num ?? o.value_text)} {s(o.unit)}</span></td>
                    <td className="muted small"><span className="ltr">{o.ref_low != null || o.ref_high != null ? `${s(o.ref_low)} – ${s(o.ref_high)}` : s(o.ref_text)}</span></td><td><InterpChip value={s(o.interpretation)} lang={lang} /></td>
                    <td className="small muted">{s(o.context)}</td></tr>))}</tbody></table></div></details>
            </>)}
        </Card>
      )}

      {inc.has("encounters") && (
        <Card title={t("الزيارات", "Visits")}>
          {(b.encounters ?? []).length === 0 ? <Empty>{t("لا زيارات ضمن النطاق.", "No visits in scope.")}</Empty> : (b.encounters ?? []).map((e, i) => (
            <article className="rec" key={i}><div className="row between"><span className="row"><span className="rec-title">{lbl(ENCOUNTER_KIND, s(e.kind), lang)}{e.reason ? ` — ${s(e.reason)}` : ""}</span>{spec(e.specialty_id) && <Chip tone="info">{spec(e.specialty_id)}</Chip>}</span><span className="muted small">{dt(e.started_at)}</span></div>
              <KV items={[[t("الطبيب", "Practitioner"), s(e.practitioner_name)], [t("المنشأة", "Facility"), s(e.facility_name)], [t("الأعراض", "Symptoms"), s(e.symptoms)], [t("الفحص", "Examination"), s(e.examination)], [t("التقييم", "Assessment"), s(e.assessment)], [t("الخطة", "Plan"), s(e.plan)], [t("الملخص", "Summary"), s(e.summary)], [t("ملخص الخروج", "Discharge"), s(e.discharge_summary)]]} /></article>))}
        </Card>
      )}

      {inc.has("other_conditions") && (
        <Card title={t("التشخيصات والحالات الأخرى", "Other diagnoses & conditions")}>
          {(b.other_conditions ?? []).length === 0 ? <Empty>{t("لا شيء ضمن النطاق.", "Nothing in scope.")}</Empty> : (b.other_conditions ?? []).map((c, i) => (
            <div key={i} className="rec row between"><span><strong>{s(c.name)}</strong> <Chip tone={c.certainty === "confirmed" ? "ok" : "muted"}>{lbl(CERTAINTY, s(c.certainty), lang)}</Chip> <span className="muted small">{lbl(CLINICAL_STATUS, s(c.clinical_status), lang)}{spec(c.specialty_id) ? ` · ${spec(c.specialty_id)}` : ""}</span></span><span className="muted small">{d(c.onset_date, c.date_precision)}</span></div>))}
        </Card>
      )}

      {inc.has("procedures") && (
        <Card title={t("العمليات والإجراءات", "Procedures & surgeries")}>
          {(b.procedures ?? []).length === 0 ? <Empty>{t("لا شيء ضمن النطاق.", "Nothing in scope.")}</Empty> : (b.procedures ?? []).map((x, i) => (
            <article className="rec" key={i}><div className="row between"><span className="rec-title">{s(x.name)} <Chip tone="muted">{lbl(PROCEDURE_KIND, s(x.kind), lang)}</Chip>{x.body_site ? <Chip tone="muted">{s(x.body_site)}</Chip> : null}</span><span className="muted small">{d(x.performed_on, x.date_precision)}</span></div>
              <KV items={[[t("المنفّذ", "Operator"), s(x.operator_name)], [t("الدافع", "Indication"), s(x.indication)], [t("النتيجة", "Outcome"), s(x.outcome)], [t("المضاعفات", "Complications"), s(x.complications)], [t("ملاحظات", "Notes"), s(x.notes)]]} /></article>))}
        </Card>
      )}

      {inc.has("imaging") && (b.imaging ?? []).length > 0 && (
        <Card title={t("الأشعة والتصوير", "Imaging")}>{(b.imaging ?? []).map((x, i) => (
          <article className="rec" key={i}><div className="row between"><span className="rec-title">{lbl(IMAGING_MODALITY, s(x.modality), lang)} {s(x.body_site)}</span><span className="muted small">{d(x.performed_on, x.date_precision)}</span></div>
            <KV items={[[t("الموجودات", "Findings"), s(x.findings)], [t("الخلاصة", "Impression"), s(x.impression)]]} /></article>))}</Card>
      )}

      {inc.has("specialty_records") && (b.specialty_records ?? []).length > 0 && (
        <Card title={t("سجلات التخصص", "Specialty records")}>{(b.specialty_records ?? []).map((x, i) => {
          const fields = (x.fields ?? []) as { key: string; label_ar: string; label_en: string; unit?: string; options?: { value: string; label_ar: string; label_en: string }[] }[];
          const data = (x.data ?? {}) as R;
          return (<article className="rec" key={i}><div className="row between"><span className="rec-title">{s(lang === "ar" ? x.record_type_name_ar : x.record_type_name_en)} <Chip tone="info">{spec(x.specialty_id)}</Chip></span><span className="muted small">{d(x.occurred_on)}</span></div>
            <KV items={fields.map((f): [string, string] => { const v = data[f.key]; const opt = f.options?.find((o) => o.value === v); return [lang === "ar" ? f.label_ar : f.label_en, v == null ? "" : `${opt ? (lang === "ar" ? opt.label_ar : opt.label_en) : s(v)}${f.unit ? " " + f.unit : ""}`]; })} />
            {x.notes ? <p className="rec-body">{s(x.notes)}</p> : null}</article>);
        })}</Card>
      )}

      {inc.has("care_plans") && (b.care_plans ?? []).length > 0 && (
        <Card title={t("خطط العلاج والمتابعة", "Care plans")}>{(b.care_plans ?? []).map((x, i) => (
          <article className="rec" key={i}><span className="rec-title">{s(x.title)}</span> <Chip tone="muted">{lbl(CARE_PLAN_STATUS, s(x.status), lang)}</Chip><KV items={[[t("الأهداف", "Goals"), s(x.goals)], [t("التعليمات", "Instructions"), s(x.instructions)]]} /></article>))}</Card>
      )}

      {inc.has("notes") && (b.notes ?? []).length > 0 && (
        <Card title={t("الملاحظات السريرية", "Clinical notes")}>{(b.notes ?? []).map((x, i) => (
          <article className="rec" key={i}><div className="row between"><strong>{s(x.title)}</strong><span className="muted small">{dt(x.noted_at)}{x.author_name ? ` · ${s(x.author_name)}` : ""}</span></div><p className="rec-body">{s(x.body)}</p></article>))}</Card>
      )}

      {inc.has("immunizations") && (b.immunizations ?? []).length > 0 && (
        <Card title={t("التطعيمات", "Immunizations")}>{(b.immunizations ?? []).map((x, i) => (
          <div className="row between" key={i}><span>{s(x.vaccine_name)}{x.dose_number ? ` #${s(x.dose_number)}` : ""} <Chip tone="muted">{lbl(IMMUNIZATION_STATUS, s(x.status), lang)}</Chip></span><span className="muted small">{d(x.administered_on, x.date_precision)}</span></div>))}</Card>
      )}

      {inc.has("family_history") && (b.family_history ?? []).length > 0 && (
        <Card title={t("التاريخ العائلي", "Family history")}>{(b.family_history ?? []).map((x, i) => (
          <div key={i}>{lbl(FAMILY_RELATION, s(x.relation), lang)}: <strong>{s(x.condition_name)}</strong>{x.age_at_onset != null ? <span className="muted small"> · {t("بدأ بعمر", "onset at")} {s(x.age_at_onset)}</span> : null}</div>))}</Card>
      )}

      {inc.has("documents") && (
        <Card title={t("المستندات والتقارير", "Documents & reports")}>
          {(b.documents ?? []).length === 0 ? <Empty>{t("لا مستندات ضمن النطاق.", "No documents in scope.")}</Empty> : (b.documents ?? []).map((x, i) => (
            <div className="rec row between" key={i}>
              <span className="row"><FileText size={16} aria-hidden="true" /><a href={`/s/${token}/doc/${s(x.id)}`} target="_blank" rel="noopener noreferrer"><strong>{s(x.title)}</strong></a><Chip tone="info">{lbl(DOC_TYPE, s(x.doc_type), lang)}</Chip>{spec(x.specialty_id) && <Chip tone="muted">{spec(x.specialty_id)}</Chip>}</span>
              <span className="row"><span className="muted small">{d(x.document_date)}</span>{b.meta.allow_download && <a className="small" href={`/s/${token}/doc/${s(x.id)}?dl=1`}>{t("تنزيل", "Download")}</a>}</span></div>))}
        </Card>
      )}

      {b.meta.allow_notes && (
        <Card title={t("ملاحظة للمريض", "Leave a note for the patient")}>
          <p className="small muted">{t("لا تُضاف ملاحظتك إلى السجل الطبي تلقائياً؛ يراجعها المريض أولاً.", "Your note is not added to the medical record automatically; the patient reviews it first.")}</p>
          <ActionForm action={addShareNote} className="stack">
            <input type="hidden" name="_t" value={token} />
            <div className="field"><label htmlFor="author_name">{t("اسمك", "Your name")}</label><input id="author_name" name="author_name" required minLength={2} maxLength={120} /></div>
            <div className="field"><label htmlFor="body">{t("الملاحظة", "Note")}</label><textarea id="body" name="body" required maxLength={4000} rows={4} /></div>
            <div><SubmitButton>{t("إرسال", "Send")}</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      <p className="small muted">{t("هذا عرض لمعلومات سجّلها المريض أو مقدمو الرعاية؛ قد لا يكون كاملاً. القرار السريري لك.", "This is a view of information recorded by the patient or care providers; it may be incomplete. Clinical judgement is yours.")} {t("أُنشئ في", "Generated at")} {dt(b.meta.generated_at)}.</p>
    </div>
  );
}
