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
import { passwordHint, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password-rules";
import { SessionsCard } from "@/components/account/SessionsCard";
import { ActivityCard } from "@/components/account/ActivityCard";
import { DeleteAccountCard } from "@/components/account/DeleteAccountCard";
import { updateProfile } from "@/app/actions/account";
import { deleteTemplate, saveTemplate } from "@/app/actions/notes";
import { ConfirmButton } from "@/components/ui/client";
import { NOTE_KIND } from "@/lib/labels";

export const metadata = { title: "حسابي" };

export default async function AccountPage({ searchParams }: { searchParams: { photo?: string; error?: string; restored?: string } }) {
  const { lang, t } = i18n();
  const [user, profile] = await Promise.all([currentUser(), currentProfile()]);
  const { count: ownFiles } = await createClient().from("patient_members").select("patient_id", { count: "exact", head: true }).eq("role", "owner").is("revoked_at", null);
  const name = profile?.full_name ?? "";
  const { data: myTemplates } = await createClient().from("note_templates").select("id, title, body, kind").eq("owner_id", user?.id ?? "").order("title");
  const src = profile?.avatar_path ? `/api/avatar?v=${encodeURIComponent(profile.updated_at)}` : null;
  return (
    <>
      <PageHead title={t("حسابي", "My account")} sub={<span className="row"><span className="ltr">{user?.email}</span>{profile?.role === "admin" && <Chip tone="info">{t("مدير", "Admin")}</Chip>}{profile?.date_of_birth && <Chip>{ageLabel(profile.date_of_birth, lang)}</Chip>}</span>} />

      {searchParams.restored === "1" && (
        <Banner tone="ok" title={t("أُلغي حذف حسابك", "Your account deletion was cancelled")}>
          {t("سجّلت الدخول خلال مهلة الـ30 يوماً، فعادت ملفاتك كما كانت. روابط المشاركة التي أُوقفت عند الطلب تبقى موقوفة؛ أنشئ غيرها إن احتجت.", "You signed in within the 30 days, so your files are back as they were. Share links that were stopped when you asked stay stopped; create new ones if you need them.")}
        </Banner>
      )}

      <Card id="photo" title={t("الصورة الشخصية", "Profile picture")}>
        <PhotoForm target="user" name={name || user?.email || ""} src={src} returnTo="/account" status={searchParams} />
      </Card>

      <Card id="details" title={t("البيانات الأساسية", "Basic details")}>
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

      <Card id="password-card" title={t("تغيير كلمة المرور", "Change password")}
        description={t("عند تغييرها تُنهى جلسات الأجهزة الأخرى.", "Changing it signs out your other devices.")}>
        <ActionForm action={updatePassword} className="stack">
          <input type="email" name="username" value={user?.email ?? ""} readOnly tabIndex={-1} autoComplete="username" aria-hidden="true" className="sr-only" />
          <div className="field">
            <label htmlFor="password">{t("كلمة المرور الجديدة", "New password")}</label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required dir="ltr" aria-describedby="password-hint" />
            <span id="password-hint" className="hint">{passwordHint(t)}</span>
          </div>
          <div><SubmitButton pending={t("جارٍ التحديث…", "Updating…")}>{t("تحديث", "Update")}</SubmitButton></div>
        </ActionForm>
      </Card>

      <SessionsCard />
      <ActivityCard />

      <Card title={t("قوالب ملاحظاتي", "My note templates")} id="templates">
        <p className="small muted">{t("تظهر قوالبك مع القوالب الجاهزة عند كتابة ملاحظة، في كل ملفاتك. هي خاصة بك ولا يراها غيرك.", "Your templates appear with the ready-made ones when you write a note, in all your files. They are private to you.")}</p>
        {(myTemplates ?? []).map((x) => (
          <details className="fold" key={x.id}>
            <summary>{x.title}</summary>
            <div className="fold-body stack">
              <ActionForm action={saveTemplate} className="stack" resetOnSuccess={false}>
                <input type="hidden" name="_id" value={x.id} />
                <div className="field"><label htmlFor={`tt-${x.id}`}>{t("العنوان", "Title")}</label><input id={`tt-${x.id}`} name="title" defaultValue={x.title} required maxLength={120} /></div>
                <div className="field"><label htmlFor={`tb-${x.id}`}>{t("النص", "Text")}</label><textarea id={`tb-${x.id}`} name="body" defaultValue={x.body} rows={5} required maxLength={8000} /></div>
                <input type="hidden" name="kind" value={x.kind} />
                <div><SubmitButton className="btn sm">{t("حفظ", "Save")}</SubmitButton></div>
              </ActionForm>
              <ActionForm action={deleteTemplate}><input type="hidden" name="_id" value={x.id} />
                <ConfirmButton message={t("حذف هذا القالب؟", "Delete this template?")}>{t("حذف القالب", "Delete the template")}</ConfirmButton></ActionForm>
            </div>
          </details>
        ))}
        <details className="fold" open={(myTemplates ?? []).length === 0}>
          <summary>{t("قالب جديد", "New template")}</summary>
          <div className="fold-body">
            <ActionForm action={saveTemplate} className="stack">
              <div className="field"><label htmlFor="nt-title">{t("العنوان", "Title")}</label><input id="nt-title" name="title" required maxLength={120} /></div>
              <div className="field"><label htmlFor="nt-kind">{t("النوع", "Type")}</label><select id="nt-kind" name="kind" defaultValue="progress">{NOTE_KIND.map((k) => <option key={k.value} value={k.value}>{k[lang]}</option>)}</select></div>
              <div className="field"><label htmlFor="nt-body">{t("النص", "Text")}</label><textarea id="nt-body" name="body" rows={6} required maxLength={8000} placeholder={t("مثلاً:\nالسن:\nالتخدير:\nما أُجري:\nالتعليمات:", "e.g.\nTooth:\nAnaesthesia:\nDone:\nInstructions:")} /></div>
              <div><SubmitButton>{t("حفظ القالب", "Save the template")}</SubmitButton></div>
            </ActionForm>
          </div>
        </details>
      </Card>

      <DeleteAccountCard email={user?.email ?? ""} />
    </>
  );
}
