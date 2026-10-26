import { Trash2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { ALLERGY_ASSERTION, ABO, RH, SEX } from "@/lib/labels";
import { Card, Chip, Empty, PageHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { deleteSimple, saveSimple, updatePatient } from "@/app/actions/patients";

const ID_TYPES: [string, string, string][] = [["national_id", "هوية وطنية", "National ID"], ["residency", "إقامة", "Residency"], ["passport", "جواز سفر", "Passport"], ["other", "أخرى", "Other"]];

export default async function ProfilePage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  const supabase = createClient();
  const [{ data: contacts }, { data: insurance }, { data: ids }] = await Promise.all([
    supabase.from("emergency_contacts").select("*").eq("patient_id", p.id).order("created_at"),
    supabase.from("patient_insurance").select("*").eq("patient_id", p.id).order("created_at"),
    access.canManage ? supabase.from("patient_identifiers").select("id, id_type, id_value").eq("patient_id", p.id) : Promise.resolve({ data: [] as { id: string; id_type: string; id_value: string }[] }),
  ]);
  const ro = !access.canWrite;
  const mask = (v: string) => (v.length <= 4 ? "••••" : "•".repeat(v.length - 4) + v.slice(-4));
  return (
    <>
      <PageHead title={t("البيانات الشخصية", "Personal details")} sub={t("العمر يُحسب من تاريخ الميلاد. الهوية الوطنية ورقم الجواز لا تُشارك أبداً.", "Age is calculated from the date of birth. National ID and passport numbers are never shared.")} />
      <Card title={t("بيانات المريض", "Patient details")}>
        <ActionForm action={updatePatient} className="stack" resetOnSuccess={false}>
          <input type="hidden" name="_pid" value={p.id} />
          <fieldset disabled={ro} style={{ border: 0, padding: 0 }}>
            <div className="form-grid">
              <div className="field"><label htmlFor="full_name">{t("الاسم الكامل", "Full name")}</label><input id="full_name" name="full_name" defaultValue={p.full_name} required maxLength={200} /></div>
              <div className="field"><label htmlFor="full_name_en">{t("الاسم بالإنجليزية", "Name in English")}</label><input id="full_name_en" name="full_name_en" dir="ltr" defaultValue={p.full_name_en ?? ""} maxLength={200} /></div>
              <div className="field"><label htmlFor="date_of_birth">{t("تاريخ الميلاد", "Date of birth")}</label><input id="date_of_birth" name="date_of_birth" type="date" defaultValue={p.date_of_birth} required /></div>
              <div className="field"><label htmlFor="sex">{t("الجنس", "Sex")}</label><select id="sex" name="sex" defaultValue={p.sex}>{SEX.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
              <div className="field"><label htmlFor="nationality">{t("الجنسية", "Nationality")}</label><input id="nationality" name="nationality" defaultValue={p.nationality ?? ""} maxLength={80} /></div>
              <div className="field"><label htmlFor="blood_abo">{t("فصيلة الدم", "Blood group")}</label><select id="blood_abo" name="blood_abo" defaultValue={p.blood_abo ?? ""}><option value="">—</option>{ABO.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
              <div className="field"><label htmlFor="blood_rh">{t("عامل Rh", "Rh factor")}</label><select id="blood_rh" name="blood_rh" defaultValue={p.blood_rh ?? ""}><option value="">—</option>{RH.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
              <div className="field"><label className="check" style={{ marginBlockStart: "1.7rem" }}><input type="checkbox" name="blood_group_verified" defaultChecked={p.blood_group_verified} />{t("فصيلة الدم موثقة بتحليل", "Blood group confirmed by a lab test")}</label></div>
              <div className="field"><label htmlFor="phone">{t("الهاتف", "Phone")}</label><input id="phone" name="phone" type="tel" dir="ltr" defaultValue={p.phone ?? ""} maxLength={40} /></div>
              <div className="field"><label htmlFor="email">{t("البريد", "Email")}</label><input id="email" name="email" type="email" dir="ltr" defaultValue={p.email ?? ""} maxLength={200} /></div>
              <div className="field wide"><label htmlFor="address_line">{t("العنوان", "Address")}</label><input id="address_line" name="address_line" defaultValue={p.address_line ?? ""} maxLength={300} /></div>
              <div className="field"><label htmlFor="city">{t("المدينة", "City")}</label><input id="city" name="city" defaultValue={p.city ?? ""} maxLength={100} /></div>
              <div className="field"><label htmlFor="country">{t("الدولة", "Country")}</label><input id="country" name="country" defaultValue={p.country ?? ""} maxLength={100} /></div>
              <div className="field wide">
                <label htmlFor="allergy_assertion">{t("حالة الحساسية", "Allergy status")}</label>
                <select id="allergy_assertion" name="allergy_assertion" defaultValue={p.allergy_assertion}>{ALLERGY_ASSERTION.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select>
                <span className="hint">{t("غياب سجلات الحساسية لا يعني عدم وجودها؛ اختر «لا توجد حساسية معروفة» فقط بعد التأكد.", "No allergy entries is not the same as no allergies; choose “No known allergies” only once you are sure.")}</span>
              </div>
            </div>
          </fieldset>
          {!ro && <div><SubmitButton>{t("حفظ", "Save")}</SubmitButton></div>}
        </ActionForm>
      </Card>

      <Card title={t("جهات الطوارئ والممثل القانوني", "Emergency contacts & legal representative")}>
        {(contacts ?? []).length === 0 ? <Empty>{t("لا توجد جهات اتصال.", "No contacts.")}</Empty> : (contacts ?? []).map((c) => (
          <div key={c.id} className="rec row between">
            <div><strong>{c.full_name}</strong> {c.relation && <span className="muted">({c.relation})</span>} <span className="ltr">{c.phone}</span> {c.is_legal_representative && <Chip tone="info">{t("ممثل قانوني", "Legal representative")}</Chip>}</div>
            {!ro && <form action={deleteSimple}><input type="hidden" name="_table" value="emergency_contacts" /><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={c.id} /><button className="btn danger sm" aria-label={t("حذف", "Delete")}><Trash2 size={14} aria-hidden="true" /></button></form>}
          </div>))}
        {!ro && (
          <details className="fold" style={{ marginBlockStart: ".8rem" }}><summary>{t("+ إضافة جهة اتصال", "+ Add a contact")}</summary><div className="fold-body">
            <ActionForm action={saveSimple} className="stack"><input type="hidden" name="_table" value="emergency_contacts" /><input type="hidden" name="_pid" value={p.id} />
              <div className="form-grid">
                <div className="field"><label>{t("الاسم", "Name")}</label><input name="full_name" required /></div>
                <div className="field"><label>{t("صلة القرابة", "Relation")}</label><input name="relation" /></div>
                <div className="field"><label>{t("الهاتف", "Phone")}</label><input name="phone" type="tel" dir="ltr" required /></div>
                <div className="field"><label className="check" style={{ marginBlockStart: "1.7rem" }}><input type="checkbox" name="is_legal_representative" />{t("ممثل قانوني / ولي أمر", "Legal representative / guardian")}</label></div>
              </div><div><SubmitButton>{t("إضافة", "Add")}</SubmitButton></div></ActionForm></div></details>)}
      </Card>

      <Card title={t("التأمين الصحي", "Health insurance")}>
        {(insurance ?? []).length === 0 ? <Empty>{t("لا توجد بيانات تأمين.", "No insurance on file.")}</Empty> : (insurance ?? []).map((i) => (
          <div key={i.id} className="rec row between"><div><strong>{i.provider}</strong> <span className="muted small">{[i.policy_number, i.class_name, i.valid_to && `${t("حتى", "until")} ${i.valid_to}`].filter(Boolean).join(" · ")}</span></div>
            {!ro && <form action={deleteSimple}><input type="hidden" name="_table" value="patient_insurance" /><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={i.id} /><button className="btn danger sm" aria-label={t("حذف", "Delete")}><Trash2 size={14} aria-hidden="true" /></button></form>}</div>))}
        {!ro && (
          <details className="fold" style={{ marginBlockStart: ".8rem" }}><summary>{t("+ إضافة تأمين", "+ Add insurance")}</summary><div className="fold-body">
            <ActionForm action={saveSimple} className="stack"><input type="hidden" name="_table" value="patient_insurance" /><input type="hidden" name="_pid" value={p.id} />
              <div className="form-grid">
                <div className="field"><label>{t("الشركة", "Provider")}</label><input name="provider" required /></div>
                <div className="field"><label>{t("رقم الوثيقة", "Policy number")}</label><input name="policy_number" dir="ltr" /></div>
                <div className="field"><label>{t("الفئة", "Class")}</label><input name="class_name" /></div>
                <div className="field"><label>{t("من", "From")}</label><input name="valid_from" type="date" /></div>
                <div className="field"><label>{t("إلى", "To")}</label><input name="valid_to" type="date" /></div>
              </div><div><SubmitButton>{t("إضافة", "Add")}</SubmitButton></div></ActionForm></div></details>)}
      </Card>

      {access.canManage && (
        <Card title={t("أرقام الهوية (خاصة، لا تُشارك)", "Identity numbers (private, never shared)")}>
          {(ids ?? []).map((i) => <div key={i.id} className="rec"><strong>{ID_TYPES.find((x) => x[0] === i.id_type)?.[lang === "ar" ? 1 : 2]}</strong> <span className="ltr">{mask(i.id_value)}</span></div>)}
          <ActionForm action={saveSimple} className="stack" >
            <input type="hidden" name="_table" value="patient_identifiers" /><input type="hidden" name="_pid" value={p.id} />
            <div className="form-grid">
              <div className="field"><label>{t("النوع", "Type")}</label><select name="id_type" defaultValue="national_id">{ID_TYPES.map((x) => <option key={x[0]} value={x[0]}>{lang === "ar" ? x[1] : x[2]}</option>)}</select></div>
              <div className="field"><label>{t("الرقم (يستبدل الرقم الحالي من النوع نفسه)", "Number (replaces the existing one of the same type)")}</label><input name="id_value" dir="ltr" required autoComplete="off" /></div>
            </div><div><SubmitButton>{t("حفظ", "Save")}</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
