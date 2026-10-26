import { i18n } from "@/lib/i18n";
import { currentProfile, currentUser } from "@/lib/auth";
import { Card, PageHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { updatePassword } from "@/app/actions/auth";

export default async function AccountPage() {
  const { t } = i18n();
  const [user, profile] = await Promise.all([currentUser(), currentProfile()]);
  return (
    <>
      <PageHead title={t("حسابي", "My account")} sub={`${profile?.full_name ?? ""} · ${user?.email ?? ""}`} />
      <Card title={t("تغيير كلمة المرور", "Change password")}>
        <ActionForm action={updatePassword} className="stack">
          <div className="field"><label htmlFor="password">{t("كلمة المرور الجديدة", "New password")}</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required dir="ltr" /></div>
          <div><SubmitButton>{t("تحديث", "Update")}</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
