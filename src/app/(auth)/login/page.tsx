import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { isConfigured } from "@/lib/env";
import { AuthShell } from "@/components/AuthShell";
import { Banner } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { login } from "@/app/actions/auth";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const { t } = i18n();
  return (
    <AuthShell>
        <div className="card auth-card">
          <h1>{t("تسجيل الدخول", "Sign in")}</h1>
          {!isConfigured() && <Banner tone="warn">{t("الاتصال بقاعدة البيانات غير مضبوط.", "Database connection is not configured.")}</Banner>}
          {searchParams.error && <Banner tone="bad">{t("تعذر إكمال تسجيل الدخول من الرابط.", "The sign-in link could not be completed.")}</Banner>}
          <ActionForm action={login} className="stack" resetOnSuccess={false}>
            <input type="hidden" name="next" value={searchParams.next ?? ""} />
            <div className="field"><label htmlFor="email">{t("البريد الإلكتروني", "Email")}</label><input id="email" name="email" type="email" autoComplete="email" required dir="ltr" /></div>
            <div className="field"><label htmlFor="password">{t("كلمة المرور", "Password")}</label><input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" /></div>
            <SubmitButton pending={t("جارٍ الدخول…", "Signing in…")}>{t("دخول", "Sign in")}</SubmitButton>
          </ActionForm>
          <p className="small" style={{ marginBlockStart: "1rem" }}>
            <Link href="/forgot">{t("نسيت كلمة المرور؟", "Forgot your password?")}</Link> · <Link href={searchParams.next ? `/signup?next=${encodeURIComponent(searchParams.next)}` : "/signup"}>{t("إنشاء حساب جديد", "Create an account")}</Link>
          </p>
        </div>
    </AuthShell>
  );
}
