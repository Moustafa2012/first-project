"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/ui/client";
import { SignaturePad } from "@/components/SignaturePad";
import { CONSENT_KIND, SIGNER_ROLE, consentTemplate } from "@/lib/consent";
import type { Lang } from "@/lib/i18n";

export interface ConsentTarget { id: string; kind: "plan" | "item"; label: string; plan_id: string }

/**
 * A consent to sign on the screen: the kind and the treatment it covers fill in the text (which can be edited before
 * signing), the signer says who they are, and signs with a finger or mouse. The text is saved with the consent as signed.
 */
export function ConsentForm({ action, hidden, lang, idPrefix, targets, signerName = "", kinds, supersede, submitLabel, presenter }: {
  action: FormAction; hidden: Record<string, string>; lang: Lang; idPrefix: string; targets: ConsentTarget[]; signerName?: string; kinds?: string[];
  /** a new version of a signed consent: the kind and what it covers are fixed */
  supersede?: { id: string; kind: string; title: string; body: string; target: string | null };
  submitLabel: string;
  /** a doctor presenting it through a link: the patient signs on the doctor's screen */
  presenter?: string;
}) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const allowed = CONSENT_KIND.filter((k) => !kinds || kinds.includes(k.value));
  const [kind, setKind] = useState(supersede?.kind ?? allowed[0]?.value ?? "treatment");
  const [target, setTarget] = useState(supersede?.target ?? "");
  const subject = targets.find((x) => x.id === target)?.label ?? null;
  const tpl = consentTemplate(kind, lang, subject);
  const [title, setTitle] = useState(supersede?.title ?? tpl.title);
  const [body, setBody] = useState(supersede?.body ?? tpl.body);
  const [touched, setTouched] = useState(Boolean(supersede));
  const pick = (k: string, tg: string) => {
    setKind(k); setTarget(tg);
    if (!touched) {
      const x = consentTemplate(k, lang, targets.find((y) => y.id === tg)?.label ?? null);
      setTitle(x.title); setBody(x.body);
    }
  };
  const tg = targets.find((x) => x.id === target);
  const id = (s: string) => `${idPrefix}_${s}`;
  return (
    <ActionForm action={action} className="stack consent-form" id={id("form")}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {supersede && <input type="hidden" name="supersedes" value={supersede.id} />}
      <input type="hidden" name="treatment_plan_id" value={tg ? tg.plan_id : ""} />
      <input type="hidden" name="treatment_item_id" value={tg?.kind === "item" ? tg.id.replace(/^item:/, "") : ""} />
      <div className="form-grid">
        <div className="field"><label htmlFor={id("kind")}>{t("نوع الموافقة", "Kind of consent")}</label>
          <select id={id("kind")} name="kind" value={kind} disabled={Boolean(supersede)} onChange={(e) => pick(e.target.value, target)}>
            {allowed.map((k) => <option key={k.value} value={k.value}>{k[lang]}</option>)}
          </select>
          {supersede && <input type="hidden" name="kind" value={kind} />}
        </div>
        <div className="field"><label htmlFor={id("target")}>{t("تشمل (خطة أو علاج)", "Covers (plan or treatment)")}</label>
          <select id={id("target")} value={target} disabled={Boolean(supersede)} onChange={(e) => pick(kind, e.target.value)}>
            <option value="">{t("— لا ترتبط بخطة —", "— not tied to a plan —")}</option>
            {targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select></div>
        <div className="field wide"><label htmlFor={id("title")}>{t("العنوان", "Title")}</label>
          <input id={id("title")} name="title" value={title} maxLength={200} required onChange={(e) => { setTitle(e.target.value); setTouched(true); }} /></div>
        <div className="field wide"><label htmlFor={id("body")}>{t("نص الموافقة (يُحفظ كما وُقّع)", "Consent text (saved as signed)")}</label>
          <textarea id={id("body")} name="body" value={body} rows={7} maxLength={20000} required onChange={(e) => { setBody(e.target.value); setTouched(true); }} /></div>
        <div className="field"><label htmlFor={id("signer")}>{t("اسم الموقّع", "Name of the signer")} <span className="req">*</span></label>
          <input id={id("signer")} name="signer_name" defaultValue={signerName} required minLength={2} maxLength={200} autoComplete="off" /></div>
        <div className="field"><label htmlFor={id("role")}>{t("صفة الموقّع", "Signing as")}</label>
          <select id={id("role")} name="signer_role" defaultValue="patient">{SIGNER_ROLE.map((r) => <option key={r.value} value={r.value}>{r[lang]}</option>)}</select></div>
        <div className="field"><label htmlFor={id("witness")}>{t("الشاهد (اختياري)", "Witness (optional)")}</label><input id={id("witness")} name="witness_name" maxLength={200} /></div>
        <SignaturePad name="signature" label={presenter ? t("توقيع المريض على الشاشة", "The patient signs here") : t("التوقيع", "Signature")} clear={t("مسح", "Clear")}
          hint={t("وقّع بإصبعك أو بالفأرة داخل المربع.", "Sign with your finger or mouse inside the box.")} />
      </div>
      {presenter && <p className="small muted" style={{ margin: 0 }}>{t(`قدّمها ${presenter}. سلّم الجهاز للمريض ليقرأ النص ويوقّع بنفسه.`, `Presented by ${presenter}. Hand the device to the patient to read the text and sign themselves.`)}</p>}
      <label className="check"><input type="checkbox" name="agree" required />{t("قرأتُ النص أعلاه وفُهم لي، وأوافق عليه، وأعلم أن لي سحب موافقتي.", "I have read and understood the text above, I agree to it, and I know I may withdraw my consent.")}</label>
      <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{submitLabel}</SubmitButton></div>
    </ActionForm>
  );
}
