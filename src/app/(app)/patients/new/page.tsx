import { i18n } from "@/lib/i18n";
import { currentProfile, currentUser } from "@/lib/auth";
import { ABO, RH, SEX } from "@/lib/labels";
import { PageHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { createPatient } from "@/app/actions/patients";

export const metadata = { title: "ملف جديد" };

export default async function NewPatientPage({ searchParams }: { searchParams: { from?: string } }) {
  const { lang, t } = i18n();
  const fromProfile = searchParams.from === "profile";
  const [profile, user] = fromProfile ? await Promise.all([currentProfile(), currentUser()]) : [null, null];
  return (
    <>
      <PageHead title={t("إنشاء ملف صحي", "Create a health file")} sub={t("تُحسب العمر تلقائياً من تاريخ الميلاد. يمكنك إكمال بقية البيانات لاحقاً.", "Age is calculated from the date of birth. You can complete the rest later.")} />
      <div className="card">
        <ActionForm action={createPatient} className="stack" resetOnSuccess={false}>
          <div className="form-grid">
            <div className="field wide">
              <label htmlFor="relationship">{t("لمن هذا الملف؟", "Whose file is this?")}</label>
              <select id="relationship" name="relationship" defaultValue={fromProfile ? "self" : "self"}>
                <option value="self">{t("لي", "Mine")}</option>
                <option value="dependent">{t("لشخص أرعاه (طفل / قريب)", "Someone I care for (child / relative)")}</option>
              </select>
            </div>
            <div className="field"><label htmlFor="full_name">{t("الاسم الكامل", "Full name")} <span className="req">*</span></label><input id="full_name" name="full_name" type="text" required minLength={2} maxLength={200} defaultValue={profile?.full_name ?? ""} /></div>
            <div className="field"><label htmlFor="full_name_en">{t("الاسم بالإنجليزية", "Name in English")}</label><input id="full_name_en" name="full_name_en" type="text" dir="ltr" maxLength={200} /></div>
            <div className="field"><label htmlFor="date_of_birth">{t("تاريخ الميلاد", "Date of birth")} <span className="req">*</span></label><input id="date_of_birth" name="date_of_birth" type="date" required max={new Date().toISOString().slice(0, 10)} defaultValue={profile?.date_of_birth ?? ""} /></div>
            <div className="field"><label htmlFor="sex">{t("الجنس", "Sex")}</label><select id="sex" name="sex" defaultValue={profile?.sex ?? "unspecified"}>{SEX.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor="nationality">{t("الجنسية", "Nationality")}</label><input id="nationality" name="nationality" type="text" maxLength={80} defaultValue={profile?.nationality ?? ""} /></div>
            <div className="field"><label htmlFor="blood_abo">{t("فصيلة الدم", "Blood group")}</label><select id="blood_abo" name="blood_abo" defaultValue={profile?.blood_abo ?? ""}><option value="">—</option>{ABO.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor="blood_rh">{t("عامل Rh", "Rh factor")}</label><select id="blood_rh" name="blood_rh" defaultValue={profile?.blood_rh ?? ""}><option value="">—</option>{RH.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor="phone">{t("الهاتف", "Phone")}</label><input id="phone" name="phone" type="tel" dir="ltr" maxLength={40} defaultValue={profile?.phone ?? ""} /></div>
            <div className="field"><label htmlFor="email">{t("البريد", "Email")}</label><input id="email" name="email" type="email" dir="ltr" maxLength={200} defaultValue={user?.email ?? ""} /></div>
            <div className="field wide"><label className="check"><input type="checkbox" name="confirm_distinct" />{t("هذا شخص مختلف حتى لو تطابق الاسم وتاريخ الميلاد مع ملف موجود", "This is a different person even if the name and birth date match an existing file")}</label></div>
          </div>
          <div><SubmitButton pending={t("جارٍ الإنشاء…", "Creating…")}>{t("إنشاء الملف", "Create file")}</SubmitButton></div>
        </ActionForm>
      </div>
    </>
  );
}
