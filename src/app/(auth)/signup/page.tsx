import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { AuthShell } from "@/components/AuthShell";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { signup } from "@/app/actions/auth";

export default function SignupPage() {
  const { t } = i18n();
  return (
    <AuthShell>
        <div className="card auth-card">
          <h1>{t("إنشاء حساب", "Create your account")}</h1>
          <ActionForm action={signup} className="stack" resetOnSuccess={false}>
            <div className="field"><label htmlFor="full_name">{t("الاسم", "Name")}</label><input id="full_name" name="full_name" type="text" autoComplete="name" required /></div>
            <div className="field"><label htmlFor="email">{t("البريد الإلكتروني", "Email")}</label><input id="email" name="email" type="email" autoComplete="email" required dir="ltr" /></div>
            <div className="field">
              <label htmlFor="password">{t("كلمة المرور", "Password")}</label>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required dir="ltr" />
              <span className="hint">{t("10 أحرف على الأقل.", "At least 10 characters.")}</span>
            </div>
            <SubmitButton pending={t("جارٍ الإنشاء…", "Creating…")}>{t("إنشاء الحساب", "Create account")}</SubmitButton>
          </ActionForm>
          <p className="small" style={{ marginBlockStart: "1rem" }}>{t("لديك حساب؟", "Already registered?")} <Link href="/login">{t("سجّل الدخول", "Sign in")}</Link></p>
        </div>
    </AuthShell>
  );
}
