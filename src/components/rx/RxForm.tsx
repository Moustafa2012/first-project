"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/ui/client";
import { FORM_LINES } from "@/lib/prescription";
import { MED_FORM, MED_ROUTE } from "@/lib/labels";
import type { Lang } from "@/lib/i18n";

/**
 * The prescription form: who prescribed it (the doctor named on the link when a doctor writes it), the date, and one block
 * per medicine with dose, route, frequency, duration, quantity and refills. Blank blocks are ignored.
 */
export function RxForm({ action, hidden, lang, today, idPrefix, prescriber, submitLabel }: {
  action: FormAction; hidden: Record<string, string>; lang: Lang; today: string; idPrefix: string;
  /** a doctor writing through a link: the name is fixed and not asked */
  prescriber?: string; submitLabel: string;
}) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const [rows, setRows] = useState(1);
  const id = (s: string) => `${idPrefix}_${s}`;
  return (
    <ActionForm action={action} className="stack rx-form" id={id("form")} resetOnSuccess>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="form-grid">
        {prescriber ? (
          <div className="field"><span className="label-like">{t("الطبيب الواصف", "Prescriber")}</span><p className="rx-fixed">{prescriber}</p></div>
        ) : (<>
          <div className="field"><label htmlFor={id("by")}>{t("الطبيب الواصف", "Prescribed by")} <span className="req">*</span></label>
            <input id={id("by")} name="prescriber_name" required minLength={2} maxLength={200} autoComplete="off" /></div>
          <div className="field"><label htmlFor={id("lic")}>{t("رقم الترخيص", "Licence no.")}</label><input id={id("lic")} name="prescriber_license" maxLength={60} dir="ltr" /></div>
          <div className="field"><label htmlFor={id("fac")}>{t("المنشأة", "Facility")}</label><input id={id("fac")} name="facility_name" maxLength={200} /></div>
        </>)}
        <div className="field"><label htmlFor={id("date")}>{t("تاريخ الوصفة", "Prescription date")}</label><input id={id("date")} name="issued_on" type="date" defaultValue={today} max={today} /></div>
        <div className="field wide"><label htmlFor={id("notes")}>{t("ملاحظات", "Notes")}</label><input id={id("notes")} name="notes" maxLength={2000} /></div>
      </div>

      {Array.from({ length: rows }, (_, i) => (
        <fieldset className="rx-line" key={i}>
          <legend>{t(`الدواء ${i + 1}`, `Medicine ${i + 1}`)}</legend>
          <div className="form-grid">
            <div className="field"><label htmlFor={id(`l${i}_g`)}>{t("الاسم العلمي", "Generic name")}</label><input id={id(`l${i}_g`)} name={`l${i}_name_generic`} maxLength={200} dir="ltr" /></div>
            <div className="field"><label htmlFor={id(`l${i}_b`)}>{t("الاسم التجاري", "Brand name")}</label><input id={id(`l${i}_b`)} name={`l${i}_name_brand`} maxLength={200} dir="ltr" /></div>
            <div className="field"><label htmlFor={id(`l${i}_s`)}>{t("التركيز", "Strength")}</label><input id={id(`l${i}_s`)} name={`l${i}_strength`} maxLength={60} dir="ltr" placeholder="500 mg" /></div>
            <div className="field"><label htmlFor={id(`l${i}_f`)}>{t("الشكل", "Form")}</label>
              <select id={id(`l${i}_f`)} name={`l${i}_form`} defaultValue=""><option value="">—</option>{MED_FORM.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor={id(`l${i}_d`)}>{t("الجرعة", "Dose")}</label><input id={id(`l${i}_d`)} name={`l${i}_dose`} maxLength={100} placeholder={t("مثل: كبسولة", "e.g. 1 capsule")} /></div>
            <div className="field"><label htmlFor={id(`l${i}_r`)}>{t("طريق الإعطاء", "Route")}</label>
              <select id={id(`l${i}_r`)} name={`l${i}_route`} defaultValue=""><option value="">—</option>{MED_ROUTE.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor={id(`l${i}_q`)}>{t("التكرار", "Frequency")}</label><input id={id(`l${i}_q`)} name={`l${i}_frequency`} maxLength={100} placeholder={t("مثل: 3 مرات يومياً", "e.g. three times a day")} /></div>
            <div className="field"><label htmlFor={id(`l${i}_n`)}>{t("المدة (أيام)", "Duration (days)")}</label><input id={id(`l${i}_n`)} name={`l${i}_duration_days`} type="number" min={1} max={3650} step={1} inputMode="numeric" dir="ltr" /></div>
            <div className="field"><label htmlFor={id(`l${i}_c`)}>{t("الكمية", "Quantity")}</label><input id={id(`l${i}_c`)} name={`l${i}_quantity`} maxLength={60} placeholder={t("مثل: 21 كبسولة", "e.g. 21 capsules")} /></div>
            <div className="field"><label htmlFor={id(`l${i}_x`)}>{t("مرات التجديد", "Refills")}</label><input id={id(`l${i}_x`)} name={`l${i}_refills`} type="number" min={0} max={24} step={1} inputMode="numeric" dir="ltr" /></div>
            <div className="field wide"><label htmlFor={id(`l${i}_i`)}>{t("تعليمات", "Instructions")}</label><input id={id(`l${i}_i`)} name={`l${i}_instructions`} maxLength={2000} placeholder={t("مثل: بعد الأكل", "e.g. after food")} /></div>
            <div className="field"><label htmlFor={id(`l${i}_p`)}>{t("سبب الاستخدام", "Reason for use")}</label><input id={id(`l${i}_p`)} name={`l${i}_indication`} maxLength={500} /></div>
            <label className="check"><input type="checkbox" name={`l${i}_as_needed`} />{t("عند الحاجة فقط", "Only when needed")}</label>
          </div>
        </fieldset>
      ))}
      <div className="row">
        {rows < FORM_LINES && <button type="button" className="btn sm" onClick={() => setRows(rows + 1)}><Plus size={14} aria-hidden="true" />{t("دواء آخر في الوصفة", "Another medicine on the prescription")}</button>}
        <SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
