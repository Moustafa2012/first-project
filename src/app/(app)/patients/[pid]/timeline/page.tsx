import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getPatient, getSpecialties, specialtyName } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtPartialDate } from "@/lib/format";
import { ENCOUNTER_KIND, lbl, PROCEDURE_KIND, IMAGING_MODALITY, DOC_TYPE } from "@/lib/labels";
import { qs } from "@/lib/qs";
import { Chip, Empty, InterpChip, PageHead } from "@/components/ui";

type SP = Record<string, string | undefined>;
interface Ev { at: string; kind: string; title: string; sub?: string; href?: string; specialty?: string | null; interp?: string; prec?: string }

const KINDS: [string, string, string][] = [
  ["visit", "الزيارات", "Visits"], ["lab", "التحاليل", "Lab reports"], ["vital", "القياسات", "Measurements"], ["procedure", "العمليات", "Procedures"],
  ["imaging", "الأشعة", "Imaging"], ["condition", "التشخيصات", "Conditions"], ["medication", "الأدوية", "Medications"], ["immunization", "التطعيمات", "Immunizations"],
  ["document", "المستندات", "Documents"], ["appointment", "المواعيد", "Appointments"], ["note", "الملاحظات", "Notes"], ["symptom", "الأعراض", "Symptoms"],
];

export default async function TimelinePage({ params, searchParams }: { params: { pid: string }; searchParams: SP }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const specs = await getSpecialties();
  const supabase = createClient();
  const base = `/patients/${p.id}`;
  const spec = searchParams.specialty || undefined;
  const only = searchParams.kind || undefined;
  const want = (k: string) => !only || only === k;
  const act: Record<string, string> = spec ? { patient_id: p.id, record_status: "active", specialty_id: spec } : { patient_id: p.id, record_status: "active" };
  const actObs: Record<string, string> = spec ? { patient_id: p.id, specialty_id: spec } : { patient_id: p.id };
  const L = 150;

  const [enc, labs, vit, proc, img, cond, med, imm, doc, apt, note, sym] = await Promise.all([
    want("visit") ? supabase.from("encounters").select("id, kind, reason, started_at, specialty_id").match(act).order("started_at", { ascending: false }).limit(L) : null,
    want("lab") ? supabase.from("lab_reports").select("id, title, lab_name, collected_at, specialty_id").match(act).order("collected_at", { ascending: false, nullsFirst: false }).limit(L) : null,
    want("vital") ? supabase.from("observations").select("id, effective_at, value_num, value_num2, unit, interpretation, specialty_id, observation_types!inner(name_ar, name_en, category)").match(actObs).in("status", ["final", "preliminary"]).eq("observation_types.category", "vital").not("interpretation", "in", searchParams.vitals === "all" ? "(none)" : "(normal,not_assessed)").order("effective_at", { ascending: false }).limit(L) : null,
    want("procedure") ? supabase.from("procedures").select("id, name, kind, performed_on, date_precision, specialty_id").match(act).not("performed_on", "is", null).order("performed_on", { ascending: false }).limit(L) : null,
    want("imaging") ? supabase.from("imaging_studies").select("id, modality, body_site, performed_on, date_precision, specialty_id").match(act).not("performed_on", "is", null).order("performed_on", { ascending: false }).limit(L) : null,
    want("condition") ? supabase.from("conditions").select("id, name, onset_date, date_precision, clinical_status, specialty_id").match(act).not("onset_date", "is", null).order("onset_date", { ascending: false }).limit(L) : null,
    want("medication") ? supabase.from("medications").select("id, name_generic, name_brand, start_date, end_date, date_precision, status, specialty_id").match(act).order("start_date", { ascending: false, nullsFirst: false }).limit(L) : null,
    want("immunization") && !spec ? supabase.from("immunizations").select("id, vaccine_name, dose_number, administered_on, date_precision, status").match(act).not("administered_on", "is", null).order("administered_on", { ascending: false }).limit(L) : null,
    want("document") ? supabase.from("medical_documents").select("id, title, doc_type, document_date, uploaded_at, specialty_id").match(act).order("uploaded_at", { ascending: false }).limit(L) : null,
    want("appointment") ? supabase.from("appointments").select("id, reason, scheduled_at, status, specialty_id").match(act).order("scheduled_at", { ascending: false }).limit(L) : null,
    want("note") ? supabase.from("clinical_notes").select("id, title, kind, noted_at, specialty_id").match(act).order("noted_at", { ascending: false }).limit(L) : null,
    want("symptom") ? supabase.from("symptom_entries").select("id, symptom, severity, body_site, onset_at, specialty_id").match(act).order("onset_at", { ascending: false }).limit(L) : null,
  ]);

  const ev: Ev[] = [];
  const rows = <R,>(r: { data: unknown } | null) => ((r?.data ?? []) as R[]);
  rows<Record<string, string>>(enc).forEach((r) => ev.push({ at: r.started_at, kind: "visit", title: lbl(ENCOUNTER_KIND, r.kind, lang) + (r.reason ? ` — ${r.reason}` : ""), href: `${base}/visits/${r.id}`, specialty: r.specialty_id }));
  rows<Record<string, string>>(labs).forEach((r) => r.collected_at && ev.push({ at: r.collected_at, kind: "lab", title: r.title, sub: r.lab_name, href: `${base}/labs`, specialty: r.specialty_id }));
  rows<Record<string, unknown>>(vit).forEach((r) => { const ty = r.observation_types as { name_ar: string; name_en: string }; ev.push({ at: String(r.effective_at), kind: "vital", title: `${lang === "ar" ? ty.name_ar : ty.name_en}: ${r.value_num}${r.value_num2 != null ? "/" + r.value_num2 : ""} ${r.unit ?? ""}`, href: `${base}/vitals`, specialty: r.specialty_id as string, interp: String(r.interpretation) }); });
  rows<Record<string, string>>(proc).forEach((r) => ev.push({ at: r.performed_on, prec: r.date_precision, kind: "procedure", title: r.name, sub: lbl(PROCEDURE_KIND, r.kind, lang), href: `${base}/procedures`, specialty: r.specialty_id }));
  rows<Record<string, string>>(img).forEach((r) => ev.push({ at: r.performed_on, prec: r.date_precision, kind: "imaging", title: [lbl(IMAGING_MODALITY, r.modality, lang), r.body_site].filter(Boolean).join(" — "), href: `${base}/imaging`, specialty: r.specialty_id }));
  rows<Record<string, string>>(cond).forEach((r) => ev.push({ at: r.onset_date, prec: r.date_precision, kind: "condition", title: r.name, sub: t("بداية الحالة", "Onset"), href: `${base}/conditions`, specialty: r.specialty_id }));
  rows<Record<string, string>>(med).forEach((r) => { const n = r.name_generic ?? r.name_brand; if (r.start_date) ev.push({ at: r.start_date, prec: r.date_precision, kind: "medication", title: n, sub: t("بدء الدواء", "Started"), href: `${base}/medications`, specialty: r.specialty_id }); if (r.end_date) ev.push({ at: r.end_date, kind: "medication", title: n, sub: t("إيقاف الدواء", "Stopped"), href: `${base}/medications`, specialty: r.specialty_id }); });
  rows<Record<string, string>>(imm).forEach((r) => ev.push({ at: r.administered_on, prec: r.date_precision, kind: "immunization", title: r.vaccine_name + (r.dose_number ? ` #${r.dose_number}` : ""), href: `${base}/immunizations` }));
  rows<Record<string, string>>(doc).forEach((r) => ev.push({ at: r.document_date ?? r.uploaded_at, kind: "document", title: r.title, sub: lbl(DOC_TYPE, r.doc_type, lang), href: `${base}/documents`, specialty: r.specialty_id }));
  rows<Record<string, string>>(apt).forEach((r) => ev.push({ at: r.scheduled_at, kind: "appointment", title: r.reason ?? t("موعد", "Appointment"), href: `${base}/appointments`, specialty: r.specialty_id }));
  rows<Record<string, string>>(note).forEach((r) => ev.push({ at: r.noted_at, kind: "note", title: r.title ?? t("ملاحظة", "Note"), href: `${base}/notes`, specialty: r.specialty_id }));
  rows<Record<string, unknown>>(sym).forEach((r) => ev.push({ at: String(r.onset_at), kind: "symptom", title: [r.symptom, r.body_site].filter(Boolean).join(" — "), sub: r.severity != null ? `${t("الشدة", "Severity")} ${r.severity}/10` : undefined, href: `${base}/symptoms`, specialty: r.specialty_id as string | null }));
  const dated = ev.filter((e) => !!e.at);
  dated.sort((a, b) => b.at.localeCompare(a.at));
  const shown = dated.slice(0, 400);
  const cur = searchParams as Record<string, string | undefined>;
  let year = "";

  return (
    <>
      <PageHead title={t("الخط الزمني للحالة الصحية", "Health timeline")} sub={t("كل الأحداث الصحية مرتبة زمنياً. القياسات تُعرض المُعلَّمة فقط افتراضياً.", "Every health event in time order. Measurements show flagged ones only by default.")} />
      <div className="tabs" aria-label={t("نوع الحدث", "Event type")}>
        <Link href={`${base}/timeline${qs(cur, { kind: undefined })}`} aria-current={!only ? "true" : undefined}>{t("الكل", "All")}</Link>
        {KINDS.map(([k, ar, en]) => <Link key={k} href={`${base}/timeline${qs(cur, { kind: k })}`} aria-current={only === k ? "true" : undefined}>{t(ar, en)}</Link>)}
      </div>
      <form method="get" className="row no-print">
        {only && <input type="hidden" name="kind" value={only} />}
        <select name="specialty" defaultValue={spec ?? ""} aria-label={t("التخصص", "Specialty")} style={{ width: "auto" }}><option value="">{t("كل التخصصات", "All specialties")}</option>{specs.map((s) => <option key={s.id} value={s.id}>{lang === "ar" ? s.name_ar : s.name_en}</option>)}</select>
        <label className="check small"><input type="checkbox" name="vitals" value="all" defaultChecked={searchParams.vitals === "all"} />{t("كل القياسات", "All measurements")}</label>
        <button className="btn sm">{t("تطبيق", "Apply")}</button>
      </form>
      {shown.length === 0 ? <Empty>{t("لا توجد أحداث.", "No events.")}</Empty> : (
        <ol className="timeline">
          {shown.map((e, i) => {
            const y = e.at.slice(0, 4);
            const head = y !== year ? <li key={`y${y}`} style={{ listStyle: "none" }}><h2 style={{ marginInlineStart: "-1.4rem" }}>{y}</h2></li> : null;
            year = y;
            const kind = KINDS.find((k) => k[0] === e.kind);
            return (<span key={i} style={{ display: "contents" }}>{head}
              <li>
                <div className="row"><span className="muted small nowrap">{e.prec ? fmtPartialDate(e.at, e.prec, lang, tz) : fmtDate(e.at, lang, tz)}</span><Chip tone="muted">{kind ? t(kind[1], kind[2]) : e.kind}</Chip>
                  {e.specialty && <Chip tone="info">{specialtyName(specs, e.specialty, lang)}</Chip>}{e.interp && <InterpChip value={e.interp} lang={lang} />}</div>
                <div>{e.href ? <Link href={e.href}>{e.title}</Link> : e.title}{e.sub && <span className="muted small"> · {e.sub}</span>}</div>
              </li></span>);
          })}
        </ol>
      )}
    </>
  );
}
