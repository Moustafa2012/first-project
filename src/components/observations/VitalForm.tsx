import { i18n } from "@/lib/i18n";
import { CONTEXT_BY_TYPE, SETTING } from "@/lib/labels";
import type { ObservationType } from "@/lib/types";
import { ActionForm, DateTimeField, SubmitButton } from "@/components/ui/client";
import { addVital } from "@/app/actions/observations";

export function VitalForm({ pid, type, encounters }: { pid: string; type: ObservationType; encounters: { id: string; label: string }[] }) {
  const { lang, t } = i18n();
  const ctx = CONTEXT_BY_TYPE[type.code] ?? [];
  const units = type.default_unit ? [type.default_unit, ...Object.keys(type.unit_conversions ?? {})] : [];
  const bp = type.value_kind === "bp";
  return (
    <ActionForm action={addVital} className="stack">
      <input type="hidden" name="_pid" value={pid} />
      <input type="hidden" name="type_id" value={type.id} />
      <div className="form-grid">
        {type.code === "other_measurement" && <div className="field wide"><label htmlFor="v_custom">{t("اسم القياس", "Measurement name")}</label><input id="v_custom" name="custom_name" type="text" required maxLength={120} /></div>}
        <div className="field">
          <label htmlFor="v_num">{bp ? t("الانقباضي (العلوي)", "Systolic (top)") : t("القيمة", "Value")} <span className="req">*</span></label>
          <input id="v_num" name="value_num" type="text" inputMode="decimal" dir="ltr" required autoComplete="off" />
        </div>
        {bp && (
          <>
            <div className="field"><label htmlFor="v_num2">{t("الانبساطي (السفلي)", "Diastolic (bottom)")} <span className="req">*</span></label><input id="v_num2" name="value_num2" type="text" inputMode="decimal" dir="ltr" required autoComplete="off" /></div>
            <div className="field"><label htmlFor="v_pulse">{t("النبض (اختياري)", "Pulse (optional)")}</label><input id="v_pulse" name="pulse" type="text" inputMode="numeric" dir="ltr" autoComplete="off" /></div>
          </>
        )}
        {units.length > 0 && (
          <div className="field"><label htmlFor="v_unit">{t("الوحدة", "Unit")}</label>
            <select id="v_unit" name="unit" defaultValue={units[0]}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
        )}
        <div className="field"><label>{t("وقت القياس", "Measured at")} <span className="req">*</span></label><DateTimeField name="effective_at" required /></div>
        {ctx.length > 0 && (
          <div className="field"><label htmlFor="v_ctx">{t("ظروف القياس", "Conditions")}</label>
            <select id="v_ctx" name="context" defaultValue=""><option value="">—</option>{ctx.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select>
            {type.code === "blood_glucose" && <span className="hint">{t("حدّد صائم / بعد الأكل لتُقيَّم القراءة بشكل صحيح.", "Choose fasting / after meal so the reading is judged correctly.")}</span>}
          </div>
        )}
        <div className="field"><label htmlFor="v_setting">{t("مكان القياس", "Where")}</label>
          <select id="v_setting" name="setting" defaultValue="home">{SETTING.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
        <div className="field"><label htmlFor="v_device">{t("الجهاز", "Device")}</label><input id="v_device" name="device" type="text" maxLength={200} /></div>
        {encounters.length > 0 && (
          <div className="field"><label htmlFor="v_enc">{t("ربط بزيارة", "Link to a visit")}</label>
            <select id="v_enc" name="encounter_id" defaultValue=""><option value="">—</option>{encounters.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></div>
        )}
        <div className="field wide"><label htmlFor="v_sym">{t("أعراض مصاحبة", "Accompanying symptoms")}</label><input id="v_sym" name="symptoms" type="text" maxLength={500} /></div>
        <div className="field wide"><label htmlFor="v_notes">{t("ملاحظات (وجبات، أدوية، نشاط…)", "Notes (meals, medication, activity…)")}</label><textarea id="v_notes" name="notes" rows={2} maxLength={500} /></div>
      </div>
      <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{t("تسجيل القراءة", "Save reading")}</SubmitButton></div>
    </ActionForm>
  );
}
