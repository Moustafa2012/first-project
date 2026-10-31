import { FilePlus2, ListChecks, PenLine, Undo2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtDateTime, localDate } from "@/lib/format";
import { ENTITIES } from "@/lib/entities";
import { CONTRIB_ENTITY, CONTRIB_MODULES, DOC_TYPE } from "@/lib/labels";
import type { ContribState } from "@/lib/share-contrib";
import { Banner, Chip, Empty } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { FieldInput } from "@/components/EntityForm";
import { SignaturePad } from "@/components/SignaturePad";
import { contributeDentalExam, contributeRecord, identifyContributor, retractContribution, shareAmendNote } from "@/app/actions/share-viewer";
import { TemplatePicker } from "@/components/TemplatePicker";
import type { ShareMyNote } from "@/lib/share-types";
import { ExamEditor } from "@/components/dental/ExamEditor";
import type { Dentition } from "@/lib/dental";

/*
 * The clinician's side of a contributing share, in pieces placed where they belong on the page: who is adding (once),
 * an "add" form inside each section (a visit under the visits, a diagnosis on the chosen tooth…), and at the end a
 * summary of what was added, each item withdrawable.
 */

const UPLOAD_ERR: Record<string, [string, string]> = {
  too_large: ["الملف أكبر من 20 ميغابايت.", "The file is larger than 20 MB."],
  bad_type: ["نوع الملف غير مسموح (PDF أو JPG أو PNG أو WebP).", "File type not allowed (PDF, JPG, PNG or WebP)."],
  active_content: ["رُفض ملف PDF لاحتوائه على محتوى نشط.", "This PDF was rejected because it contains active content."],
  no_file: ["اختر ملفاً.", "Choose a file."], limit: ["بلغت المشاركة الحد الأقصى للإضافات.", "The share reached its limit of additions."],
};

// filled in from the clinician's identity, not asked again
const AUTO_NAMES = ["practitioner_name", "author_name", "ordered_by", "prescriber_name", "operator_name"];
const DEFAULTS: Record<string, Record<string, string>> = { medications: { origin: "prescribed" }, test_orders: { status: "requested" }, encounters: { kind: "clinic" } };

/** May this clinician add to `table` now (identified, and the patient allowed that kind of record)? */
export function canAdd(st: ContribState | null | undefined, table: string): boolean {
  if (!st?.contributor || !(st.modules ?? []).includes(table)) return false;
  return table === "dental_exams" || table === "treatment_plans" ? Boolean(st.covers_dentistry) : true;
}
const EXTRA_LABELS: Record<string, [string, string]> = { treatment_costs: ["تكلفة علاج", "Treatment cost"], treatment_plans: ["خطة علاج", "Treatment plan"] };
export const contribLabel = (table: string, lang: "ar" | "en") =>
  EXTRA_LABELS[table]?.[lang === "ar" ? 0 : 1] ?? CONTRIB_MODULES.find((m) => m.value === table)?.[lang] ?? table;

/** Who is adding: the identity + signature form first, then "adding as …" with the count. */
export function ContributorCard({ token, st, uploaded, uploadError }: { token: string; st: ContribState; uploaded?: boolean; uploadError?: string }) {
  const { lang, t } = i18n();
  const who = st.contributor;
  const modules = st.modules ?? [];
  return (
    <section className="card" id="contributor" aria-label={t("الإضافة إلى ملف المريض", "Add to the patient's file")}>
      <div className="card-head"><h2><FilePlus2 size={18} aria-hidden="true" /> {t("الإضافة إلى ملف المريض", "Add to the patient's file")}</h2>
        <Chip tone="muted">{t(`${st.used ?? 0} من ${st.max ?? 0} إضافة`, `${st.used ?? 0} of ${st.max ?? 0} additions`)}</Chip></div>
      <p className="small muted">{t("سمح لك المريض بإضافة ما يلي. تُحفظ إضافاتك باسمك ضمن نطاق هذه المشاركة، ويراها المريض ويستطيع إبطالها. لا يمكنك تعديل أو حذف ما سجله المريض.",
        "The patient allowed you to add the following. Your additions are saved under your name within this share's scope; the patient sees them and can invalidate them. You cannot change or remove what the patient recorded.")}</p>
      <p className="small">{modules.map((m) => <Chip key={m} tone="info">{contribLabel(m, lang)}</Chip>)}</p>
      {!who ? (
        <ActionForm action={identifyContributor} className="stack" resetOnSuccess={false}>
          <input type="hidden" name="_t" value={token} />
          <h3>{t("عرّف بنفسك ووقّع مرة واحدة، ثم أضف في مكان كل معلومة", "Identify yourself and sign once, then add where each piece of information belongs")}</h3>
          <div className="form-grid">
            <div className="field"><label htmlFor="c_name">{t("الاسم الكامل", "Full name")} <span className="req">*</span></label><input id="c_name" name="full_name" required minLength={3} maxLength={120} autoComplete="name" /></div>
            <div className="field"><label htmlFor="c_spec">{t("التخصص", "Specialty")}</label><input id="c_spec" name="specialty" maxLength={120} /></div>
            <div className="field"><label htmlFor="c_lic">{t("رقم الترخيص / النقابة", "License / registration no.")}</label><input id="c_lic" name="license_no" maxLength={60} dir="ltr" /></div>
            <div className="field"><label htmlFor="c_fac">{t("العيادة / المنشأة", "Clinic / facility")}</label><input id="c_fac" name="facility" maxLength={200} /></div>
            <div className="field"><label htmlFor="c_phone">{t("الهاتف (اختياري)", "Phone (optional)")}</label><input id="c_phone" name="phone" maxLength={40} dir="ltr" inputMode="tel" /></div>
            <SignaturePad name="signature" label={t("التوقيع", "Signature")} clear={t("مسح", "Clear")}
              hint={t("وقّع بإصبعك أو بالفأرة داخل المربع.", "Sign with your finger or mouse inside the box.")} />
          </div>
          <label className="check"><input type="checkbox" name="attest" required />{t("أُقرّ بأنني الطبيب المعالج لهذا المريض، وأن ما سأضيفه صحيح بحسب علمي، وأن اسمي وتوقيعي سيُحفظان مع كل إضافة.",
            "I confirm I am treating this patient, that what I add is accurate to my knowledge, and that my name and signature are kept with every addition.")}</label>
          <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{t("متابعة", "Continue")}</SubmitButton></div>
        </ActionForm>
      ) : (
        <div className="stack">
          <p className="row" style={{ gap: ".4rem", margin: 0 }}><PenLine size={16} aria-hidden="true" />{t("تضيف باسم", "Adding as")} <strong>{who.full_name}</strong>
            {[who.specialty, who.facility, who.license_no && `${t("ترخيص", "license")} ${who.license_no}`].filter(Boolean).map((x) => <Chip key={String(x)} tone="muted">{x}</Chip>)}</p>
          <p className="small muted" style={{ margin: 0 }}>{t("نماذج الإضافة موجودة في كل قسم من هذه الصفحة؛ وفي مخطط الأسنان اختر السن ثم أضف له.",
            "The add forms are in each section of this page; on the tooth chart, choose a tooth and add to it.")} <a href="#contribute">{t("ملخص ما أضفته ↓", "Summary of what you added ↓")}</a></p>
          {uploaded && <Banner tone="ok">{t("رُفع المستند وأُضيف إلى الملف.", "Document uploaded and added to the file.")}</Banner>}
          {uploadError && <Banner tone="bad">{UPLOAD_ERR[uploadError] ? t(...UPLOAD_ERR[uploadError]) : t("تعذر رفع المستند.", "The upload failed.")}</Banner>}
        </div>
      )}
    </section>
  );
}

/**
 * The form adding one record to `table`. `fixed` values are sent, not asked; `external` fields come from a control
 * outside the form (the tooth chosen on the chart); `pick` keeps a short form to the fields that matter there.
 */
export function ContribForm({ token, st, table, formId, fixed = {}, external = [], pick, defaults, submitLabel, suggest, templates }: {
  token: string; st: ContribState; table: string; formId?: string; fixed?: Record<string, string>; external?: string[]; pick?: string[];
  defaults?: Record<string, string>; submitLabel?: string; suggest?: Record<string, string[]>; templates?: { id: string; title: string; body: string }[];
}) {
  const { lang, t } = i18n();
  const tz = getTz();
  const def = ENTITIES[CONTRIB_ENTITY[table]];
  if (!def || !st.contributor) return null;
  const fields = def.fields.filter((f) => f.kind !== "specialty" && !(f.only === "dental" && !st.covers_dentistry) && !AUTO_NAMES.includes(f.name)
    && !(f.name in fixed) && !external.includes(f.name) && (!pick || pick.includes(f.name)));
  const encounters = st.encounters ?? [];
  const linkable = table !== "encounters" && encounters.length > 0;
  const dflt = { ...(DEFAULTS[table] ?? {}), ...(defaults ?? {}) };
  const prefix = formId ? `${formId}_${table}` : `c_${table}`;
  return (
    <ActionForm action={contributeRecord} className="stack" id={formId}>
      <input type="hidden" name="_t" value={token} /><input type="hidden" name="_table" value={table} /><input type="hidden" name="_who" value={st.contributor.full_name} />
      <input type="hidden" name="_fields" value={[...fields.map((f) => f.name), ...Object.keys(fixed), ...external].join(",")} />
      {Object.entries(fixed).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {table === "clinical_notes" && templates && templates.length > 0 && <TemplatePicker target={`${prefix}_body`} templates={templates} lang={lang} />}
      <div className="form-grid">
        {linkable && <div className="field"><label htmlFor={`${formId ?? table}_enc`}>{t("ضمن زيارة أضفتها", "Within a visit you added")}</label>
          <select id={`${formId ?? table}_enc`} name="_encounter" defaultValue=""><option value="">—</option>
            {encounters.map((e) => <option key={e.id} value={e.id}>{fmtDate(e.started_at, lang, tz)} — {e.reason ?? e.kind}</option>)}</select></div>}
        {fields.map((f) => <FieldInput key={f.name} def={f} lang={lang} specialties={[]} prefix={prefix} value={dflt[f.name]} suggest={suggest?.[f.name]} />)}
      </div>
      <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{submitLabel ?? t("إضافة إلى الملف", "Add to the file")}</SubmitButton></div>
    </ActionForm>
  );
}

/** "Add: …" folded inside the section it belongs to; nothing when this clinician may not add it. */
export function ContribAdd({ token, st, table, dentition = "permanent", uploadError, templates }: { token: string; st: ContribState | null | undefined; table: string; dentition?: Dentition; uploadError?: string; templates?: { id: string; title: string; body: string }[] }) {
  const { lang, t } = i18n();
  const tz = getTz();
  if (!st || !canAdd(st, table)) return null;
  const label = contribLabel(table, lang);
  if (table === "dental_exams") return (
    <details className="fold" id="contrib-dental">
      <summary>{t(`إضافة: ${label}`, `Add: ${label}`)}</summary>
      <div className="fold-body">
        <ExamEditor action={contributeDentalExam} hidden={{ _t: token }} lang={lang} today={localDate(new Date(), tz)} defaultDentition={dentition}
          conditions={st.conditions ?? []} examiner={st.contributor!.full_name} idPrefix="cx"
          encounters={(st.encounters ?? []).map((e) => ({ id: e.id, label: `${fmtDate(e.started_at, lang, tz)} — ${e.reason ?? e.kind}` }))} />
      </div>
    </details>
  );
  if (table === "medical_documents") return (
    <details className="fold" open={Boolean(uploadError)}>
      <summary>{t(`إضافة: ${label}`, `Add: ${label}`)}</summary>
      <div className="fold-body">
        <form method="post" action={`/s/${token}/upload`} encType="multipart/form-data" className="stack">
          <div className="form-grid">
            <div className="field wide"><label htmlFor="c_file">{t("الملف (PDF / JPG / PNG / WebP، حتى 20 ميغابايت)", "File (PDF / JPG / PNG / WebP, up to 20 MB)")} <span className="req">*</span></label><input id="c_file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" /></div>
            <div className="field"><label htmlFor="c_title">{t("العنوان", "Title")}</label><input id="c_title" name="title" maxLength={200} /></div>
            <div className="field"><label htmlFor="c_dtype">{t("النوع", "Type")}</label><select id="c_dtype" name="doc_type" defaultValue={st.covers_dentistry ? "dental_image" : "other"}>{DOC_TYPE.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor="c_ddate">{t("تاريخ المستند", "Document date")}</label><input id="c_ddate" name="document_date" type="date" /></div>
            <div className="field wide"><label htmlFor="c_desc">{t("وصف", "Description")}</label><textarea id="c_desc" name="description" rows={2} maxLength={1000} /></div>
          </div>
          <div><button className="btn primary">{t("رفع", "Upload")}</button></div>
        </form>
      </div>
    </details>
  );
  if (!CONTRIB_ENTITY[table]) return null;
  return (
    <details className="fold">
      <summary>{t(`إضافة: ${label}`, `Add: ${label}`)}</summary>
      <div className="fold-body">
        {table === "clinical_notes" && <p className="small muted" style={{ marginBlockStart: 0 }}>{t("تُحفظ ملاحظتك موقّعةً باسمك؛ وأي تغيير لاحق يُضاف تعديلاً موثّقاً مع سببه.", "Your note is saved signed with your name; any later change is added as an amendment with its reason.")}</p>}
        <ContribForm token={token} st={st} table={table} templates={templates} />
      </div>
    </details>
  );
}

/** At the end of the page: what this share added, each item withdrawable (it stays in the history with the reason). */
export function ContribSummary({ token, st, myNotes = [] }: { token: string; st: ContribState; myNotes?: ShareMyNote[] }) {
  const { lang, t } = i18n();
  const tz = getTz();
  if (!st.contributor) return null;
  const items = st.items ?? [];
  return (
    <section className="card" id="contribute" aria-label={t("ملخص ما أضفته", "Summary of what you added")}>
      <div className="card-head"><h2><ListChecks size={18} aria-hidden="true" /> {t("ملخص ما أُضيف عبر هذه المشاركة", "Summary of what was added through this share")}</h2>
        <Chip tone="muted">{t(`${st.used ?? 0} من ${st.max ?? 0} إضافة`, `${st.used ?? 0} of ${st.max ?? 0} additions`)}</Chip></div>
      {myNotes.filter((n) => n.record_status === "active").length > 0 && (
        <div className="stack" style={{ marginBlockEnd: ".9rem" }}>
          <h3 style={{ margin: 0 }}>{t("ملاحظاتك الموقّعة", "Your signed notes")}</h3>
          {myNotes.filter((n) => n.record_status === "active").map((n) => (
            <article key={n.id} className="rec my-note">
              <div className="row between"><strong>{n.title || t("ملاحظة", "Note")}</strong><span className="muted small">{fmtDateTime(n.noted_at, lang, tz)}</span></div>
              <p className="rec-body">{n.body}</p>
              <p className="small note-sign">{t("موقّعة", "Signed")}{n.signed_name ? ` — ${n.signed_name}` : ""}{n.signed_at ? ` · ${fmtDateTime(n.signed_at, lang, tz)}` : ""}</p>
              {n.amendments.map((a, j) => <div className="amendment" key={j}><div className="small"><strong>{t(`تعديل موثّق ${j + 1}`, `Amendment ${j + 1}`)}</strong> · {fmtDateTime(a.amended_at, lang, tz)} — {t("السبب", "Reason")}: {a.reason}</div><p className="rec-body">{a.body}</p></div>)}
              <details className="fold"><summary>{t("تعديل موثّق", "Add an amendment")}</summary><div className="fold-body">
                <ActionForm action={shareAmendNote} className="stack">
                  <input type="hidden" name="_t" value={token} /><input type="hidden" name="_id" value={n.id} />
                  <div className="field"><label htmlFor={`sam-${n.id}`}>{t("نص التعديل", "Amendment")}</label><textarea id={`sam-${n.id}`} name="body" rows={3} required defaultValue={n.amendments.at(-1)?.body ?? n.body} /></div>
                  <div className="field"><label htmlFor={`samr-${n.id}`}>{t("السبب", "Reason")}</label><input id={`samr-${n.id}`} name="reason" required minLength={3} maxLength={500} /></div>
                  <div><SubmitButton className="btn sm primary">{t("إضافة التعديل", "Add the amendment")}</SubmitButton></div>
                </ActionForm>
              </div></details>
            </article>
          ))}
        </div>
      )}
      {items.length === 0 ? <Empty>{t("لا إضافات بعد.", "Nothing added yet.")}</Empty> : items.map((it) => (
        <article key={`${it.table}:${it.id}`} className={`rec${it.record_status !== "active" ? " error" : ""}`}>
          <div className="row between">
            <span className="row" style={{ gap: ".4rem" }}><Chip tone="info">{contribLabel(it.table, lang)}</Chip><strong>{it.label || "—"}</strong>
              {it.record_status !== "active" && <Chip tone="bad">{t("مسحوب / مُبطل", "Withdrawn / invalidated")}</Chip>}</span>
            <span className="muted small">{it.at ? fmtDateTime(it.at, lang, tz) : ""} · {it.by}</span>
          </div>
          {it.record_status === "active" && (
            <details className="fold"><summary><Undo2 size={14} aria-hidden="true" />{t("سحب هذه الإضافة", "Withdraw this addition")}</summary>
              <div className="fold-body">
                <ActionForm action={retractContribution} className="row">
                  <input type="hidden" name="_t" value={token} /><input type="hidden" name="_table" value={it.table} /><input type="hidden" name="_id" value={it.id} />
                  <input name="reason" required minLength={3} maxLength={400} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 180 }} />
                  <ConfirmButton message={t("سحب هذه الإضافة؟ تبقى في التاريخ مع السبب.", "Withdraw this addition? It stays in the history with the reason.")}>{t("سحب", "Withdraw")}</ConfirmButton>
                </ActionForm>
              </div>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
