import { FilePlus2, PenLine, Undo2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ENTITIES } from "@/lib/entities";
import { CONTRIB_ENTITY, CONTRIB_MODULES, DOC_TYPE } from "@/lib/labels";
import type { ContribState } from "@/lib/share-contrib";
import { Banner, Card, Chip, Empty } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { FieldInput } from "@/components/EntityForm";
import { SignaturePad } from "@/components/SignaturePad";
import { contributeRecord, identifyContributor, retractContribution } from "@/app/actions/share-viewer";

const UPLOAD_ERR: Record<string, [string, string]> = {
  too_large: ["الملف أكبر من 20 ميغابايت.", "The file is larger than 20 MB."],
  bad_type: ["نوع الملف غير مسموح (PDF أو JPG أو PNG أو WebP).", "File type not allowed (PDF, JPG, PNG or WebP)."],
  active_content: ["رُفض ملف PDF لاحتوائه على محتوى نشط.", "This PDF was rejected because it contains active content."],
  no_file: ["اختر ملفاً.", "Choose a file."], limit: ["بلغت المشاركة الحد الأقصى للإضافات.", "The share reached its limit of additions."],
};

/** The clinician's side of a contributing share: identify + sign once, then add records under their own name. */
export function ContributePanel({ token, st, uploaded, uploadError }: { token: string; st: ContribState; uploaded?: boolean; uploadError?: string }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const modules = st.modules ?? [];
  const who = st.contributor;
  const labelOf = (table: string) => CONTRIB_MODULES.find((m) => m.value === table)?.[lang] ?? table;
  const forms = modules.filter((m) => CONTRIB_ENTITY[m]);
  const encounters = st.encounters ?? [];

  return (
    <section className="card" id="contribute" aria-label={t("الإضافة إلى ملف المريض", "Add to the patient's file")}>
      <div className="card-head"><h2><FilePlus2 size={18} aria-hidden="true" /> {t("الإضافة إلى ملف المريض", "Add to the patient's file")}</h2>
        <Chip tone="muted">{t(`${st.used ?? 0} من ${st.max ?? 0} إضافة`, `${st.used ?? 0} of ${st.max ?? 0} additions`)}</Chip></div>
      <p className="small muted">{t("سمح لك المريض بإضافة ما يلي. تُحفظ إضافاتك باسمك ضمن نطاق هذه المشاركة، ويراها المريض ويستطيع إبطالها. لا يمكنك تعديل أو حذف ما سجله المريض.",
        "The patient allowed you to add the following. Your additions are saved under your name within this share's scope; the patient sees them and can invalidate them. You cannot change or remove what the patient recorded.")}</p>
      <p className="small">{modules.map((m) => <Chip key={m} tone="info">{labelOf(m)}</Chip>)}</p>

      {!who ? (
        <ActionForm action={identifyContributor} className="stack" resetOnSuccess={false}>
          <input type="hidden" name="_t" value={token} />
          <h3>{t("عرّف بنفسك ووقّع", "Identify yourself and sign")}</h3>
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
          <p className="row" style={{ gap: ".4rem" }}><PenLine size={16} aria-hidden="true" />{t("تضيف باسم", "Adding as")} <strong>{who.full_name}</strong>
            {[who.specialty, who.facility, who.license_no && `${t("ترخيص", "license")} ${who.license_no}`].filter(Boolean).map((x) => <Chip key={String(x)} tone="muted">{x}</Chip>)}</p>
          {uploaded && <Banner tone="ok">{t("رُفع المستند وأُضيف إلى الملف.", "Document uploaded and added to the file.")}</Banner>}
          {uploadError && <Banner tone="bad">{UPLOAD_ERR[uploadError] ? t(...UPLOAD_ERR[uploadError]) : t("تعذر رفع المستند.", "The upload failed.")}</Banner>}
          {forms.map((table) => {
            const def = ENTITIES[CONTRIB_ENTITY[table]];
            const fields = def.fields.filter((f) => f.kind !== "specialty" && !["practitioner_name", "author_name", "ordered_by", "prescriber_name", "operator_name"].includes(f.name));
            const linkable = table !== "encounters" && encounters.length > 0;
            const defaults: Record<string, string> = table === "medications" ? { origin: "prescribed" } : table === "test_orders" ? { status: "requested" } : table === "encounters" ? { kind: "clinic" } : {};
            return (
              <details className="fold" key={table}>
                <summary>{t(`إضافة: ${labelOf(table)}`, `Add: ${labelOf(table)}`)}</summary>
                <div className="fold-body">
                  <ActionForm action={contributeRecord} className="stack">
                    <input type="hidden" name="_t" value={token} /><input type="hidden" name="_table" value={table} /><input type="hidden" name="_who" value={who.full_name} />
                    <div className="form-grid">
                      {linkable && <div className="field"><label htmlFor={`${table}_enc`}>{t("ضمن زيارة أضفتها", "Within a visit you added")}</label>
                        <select id={`${table}_enc`} name="_encounter" defaultValue=""><option value="">—</option>
                          {encounters.map((e) => <option key={e.id} value={e.id}>{fmtDate(e.started_at, lang, tz)} — {e.reason ?? e.kind}</option>)}</select></div>}
                      {fields.map((f) => <FieldInput key={f.name} def={f} lang={lang} specialties={[]} prefix={`c_${table}`} value={defaults[f.name]} />)}
                    </div>
                    <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{t("إضافة إلى الملف", "Add to the file")}</SubmitButton></div>
                  </ActionForm>
                </div>
              </details>
            );
          })}
          {modules.includes("medical_documents") && (
            <details className="fold" open={Boolean(uploadError)}>
              <summary>{t(`إضافة: ${labelOf("medical_documents")}`, `Add: ${labelOf("medical_documents")}`)}</summary>
              <div className="fold-body">
                <form method="post" action={`/s/${token}/upload`} encType="multipart/form-data" className="stack">
                  <div className="form-grid">
                    <div className="field wide"><label htmlFor="c_file">{t("الملف (PDF / JPG / PNG / WebP، حتى 20 ميغابايت)", "File (PDF / JPG / PNG / WebP, up to 20 MB)")} <span className="req">*</span></label><input id="c_file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" /></div>
                    <div className="field"><label htmlFor="c_title">{t("العنوان", "Title")}</label><input id="c_title" name="title" maxLength={200} /></div>
                    <div className="field"><label htmlFor="c_dtype">{t("النوع", "Type")}</label><select id="c_dtype" name="doc_type" defaultValue="dental_image">{DOC_TYPE.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
                    <div className="field"><label htmlFor="c_ddate">{t("تاريخ المستند", "Document date")}</label><input id="c_ddate" name="document_date" type="date" /></div>
                    <div className="field wide"><label htmlFor="c_desc">{t("وصف", "Description")}</label><textarea id="c_desc" name="description" rows={2} maxLength={1000} /></div>
                  </div>
                  <div><button className="btn primary">{t("رفع", "Upload")}</button></div>
                </form>
              </div>
            </details>
          )}

          <h3>{t("ما أُضيف عبر هذه المشاركة", "Added through this share")}</h3>
          {(st.items ?? []).length === 0 ? <Empty>{t("لا إضافات بعد.", "Nothing added yet.")}</Empty> : (st.items ?? []).map((it) => (
            <article key={`${it.table}:${it.id}`} className={`rec${it.record_status !== "active" ? " error" : ""}`}>
              <div className="row between">
                <span className="row" style={{ gap: ".4rem" }}><Chip tone="info">{labelOf(it.table)}</Chip><strong>{it.label || "—"}</strong>
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
        </div>
      )}
    </section>
  );
}
