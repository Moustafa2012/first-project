import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { currentProfile, currentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ABO, RH, SEX } from "@/lib/labels";
import { ageLabel } from "@/lib/format";
import { Banner, Card, Chip, PageHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { PhotoForm } from "@/components/PhotoForm";
import { updatePassword } from "@/app/actions/auth";
import { updateProfile } from "@/app/actions/account";

export const metadata = { title: "حسابي" };

export default async function AccountPage({ searchParams }: { searchParams: { photo?: string; error?: string } }) {
  const { lang, t } = i18n();
  const [user, profile] = await Promise.all([currentUser(), currentProfile()]);
  const { count: ownFiles } = await createClient().from("patient_members").select("patient_id", { count: "exact", head: true }).eq("role", "owner").is("revoked_at", null);
  const name = profile?.full_name ?? "";
  const src = profile?.avatar_path ? `/api/avatar?v=${encodeURIComponent(profile.updated_at)}` : null;
  return (
    <>
      <PageHead title={t("حسابي", "My account")} sub={<span className="row"><span className="ltr">{user?.email}</span>{profile?.role === "admin" && <Chip tone="info">{t("مدير", "Admin")}</Chip>}{profile?.date_of_birth && <Chip>{ageLabel(profile.date_of_birth, lang)}</Chip>}</span>} />

      <Card title={t("الصورة الشخصية", "Profile picture")}>
        <PhotoForm target="user" name={name || user?.email || ""} src={src} returnTo="/account" status={searchParams} />
      </Card>

      <Card title={t("البيانات الأساسية", "Basic details")}>
        <p className="muted small">{t("هذه بيانات حسابك أنت. ملفاتك الطبية منفصلة، ويمكنك إنشاء ملفك الصحي منها بنقرة واحدة.", "These are your own account details. Health files are separate, and you can create your own file from them in one click.")}</p>
        <ActionForm action={updateProfile} className="stack" resetOnSuccess={false}>
          <div className="form-grid">
            <div className="field"><label htmlFor="full_name">{t("الاسم الكامل", "Full name")} <span className="req">*</span></label><input id="full_name" name="full_name" type="text" defaultValue={name} required minLength={2} maxLength={200} autoComplete="name" /></div>
            <div className="field"><label htmlFor="date_of_birth">{t("تاريخ الميلاد", "Date of birth")}</label><input id="date_of_birth" name="date_of_birth" type="date" defaultValue={profile?.date_of_birth ?? ""} max={new Date().toISOString().slice(0, 10)} autoComplete="bday" /></div>
            <div className="field"><label htmlFor="sex">{t("الجنس", "Sex")}</label><select id="sex" name="sex" defaultValue={profile?.sex ?? ""}><option value="">—</option>{SEX.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor="blood_abo">{t("فصيلة الدم", "Blood group")}</label><select id="blood_abo" name="blood_abo" defaultValue={profile?.blood_abo ?? ""}><option value="">—</option>{ABO.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor="blood_rh">{t("عامل Rh", "Rh factor")}</label><select id="blood_rh" name="blood_rh" defaultValue={profile?.blood_rh ?? ""}><option value="">—</option>{RH.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
            <div className="field"><label htmlFor="phone">{t("الهاتف", "Phone")}</label><input id="phone" name="phone" type="tel" dir="ltr" defaultValue={profile?.phone ?? ""} maxLength={40} autoComplete="tel" /></div>
            <div className="field"><label htmlFor="nationality">{t("الجنسية", "Nationality")}</label><input id="nationality" name="nationality" type="text" defaultValue={profile?.nationality ?? ""} maxLength={80} /></div>
            <div className="field"><label htmlFor="country">{t("الدولة", "Country")}</label><input id="country" name="country" type="text" defaultValue={profile?.country ?? ""} maxLength={100} autoComplete="country-name" /></div>
            <div className="field"><label htmlFor="city">{t("المدينة", "City")}</label><input id="city" name="city" type="text" defaultValue={profile?.city ?? ""} maxLength={100} autoComplete="address-level2" /></div>
            <div className="field"><label htmlFor="preferred_lang">{t("اللغة المفضلة", "Preferred language")}</label><select id="preferred_lang" name="preferred_lang" defaultValue={profile?.preferred_lang ?? "ar"}><option value="ar">العربية</option><option value="en">English</option></select></div>
            <div className="field"><label htmlFor="acc_email">{t("البريد الإلكتروني", "Email")}</label><input id="acc_email" type="email" dir="ltr" value={user?.email ?? ""} readOnly disabled /><span className="hint">{t("لا يمكن تغيير البريد من هنا.", "The email cannot be changed here.")}</span></div>
          </div>
          <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{t("حفظ التغييرات", "Save changes")}</SubmitButton></div>
        </ActionForm>
      </Card>

      {!ownFiles && (
        <Banner tone="info" title={t("ليس لديك ملف صحي خاص بك بعد", "You do not have a health file of your own yet")}>
          <Link className="btn sm" href="/patients/new?from=profile" style={{ marginInlineStart: ".5rem" }}><FilePlus2 size={14} aria-hidden="true" />{t("أنشئه من بيانات حسابي", "Create it from my details")}</Link>
        </Banner>
      )}

      <Card title={t("تغيير كلمة المرور", "Change password")}>
        <ActionForm action={updatePassword} className="stack">
          <div className="field"><label htmlFor="password">{t("كلمة المرور الجديدة", "New password")}</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required dir="ltr" /></div>
          <div><SubmitButton>{t("تحديث", "Update")}</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
