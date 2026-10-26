import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { Topbar } from "@/components/Topbar";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { requestReset } from "@/app/actions/auth";

export default function ForgotPage() {
  const { t } = i18n();
  return (
    <>
      <Topbar signedIn={false} />
      <main className="container narrow">
        <div className="card auth-card">
          <h1>{t("استعادة كلمة المرور", "Reset password")}</h1>
          <ActionForm action={requestReset} className="stack">
            <div className="field"><label htmlFor="email">{t("البريد الإلكتروني", "Email")}</label><input id="email" name="email" type="email" required dir="ltr" /></div>
            <SubmitButton>{t("أرسل رابط الاستعادة", "Send reset link")}</SubmitButton>
          </ActionForm>
          <p className="small" style={{ marginBlockStart: "1rem" }}><Link href="/login">{t("العودة لتسجيل الدخول", "Back to sign in")}</Link></p>
        </div>
      </main>
    </>
  );
}
