import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { AuthShell } from "@/components/AuthShell";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { signup } from "@/app/actions/auth";
import { PASSWORD_MAX, PASSWORD_MIN, passwordHint } from "@/lib/password-rules";

export default function SignupPage() {
  const { t } = i18n();
  return (
    <AuthShell>
        <div className="card auth-card">
          <h1>{t("إنشاء حساب", "Create your account")}</h1>
          <ActionForm action={signup} className="stack" resetOnSuccess={false}>
            <div className="field"><label htmlFor="full_name">{t("الاسم", "Name")}</label><input id="full_name" name="full_name" type="text" autoComplete="name" minLength={2} maxLength={200} required /></div>
            <div className="field"><label htmlFor="email">{t("البريد الإلكتروني", "Email")}</label><input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required dir="ltr" /></div>
            <div className="field">
              <label htmlFor="password">{t("كلمة المرور", "Password")}</label>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required dir="ltr" aria-describedby="password-hint" />
              <span id="password-hint" className="hint">{passwordHint(t)}</span>
            </div>
            <SubmitButton pending={t("جارٍ الإنشاء…", "Creating…")}>{t("إنشاء الحساب", "Create account")}</SubmitButton>
          </ActionForm>
          <p className="small" style={{ marginBlockStart: "1rem" }}>{t("لديك حساب؟", "Already registered?")} <Link href="/login">{t("سجّل الدخول", "Sign in")}</Link></p>
        </div>
    </AuthShell>
  );
}
