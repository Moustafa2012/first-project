import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { isConfigured } from "@/lib/env";
import { AuthShell } from "@/components/AuthShell";
import { Banner } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { login } from "@/app/actions/auth";
import { PASSWORD_MAX } from "@/lib/password-rules";
import { fmtDate } from "@/lib/format";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string; deleted?: string; on?: string } }) {
  const { t, lang } = i18n();
  return (
    <AuthShell>
        <div className="card auth-card">
          <h1>{t("تسجيل الدخول", "Sign in")}</h1>
          {!isConfigured() && <Banner tone="warn">{t("الاتصال بقاعدة البيانات غير مضبوط.", "Database connection is not configured.")}</Banner>}
          {searchParams.error === "deleted" && <Banner tone="bad">{t("حُذف هذا الحساب نهائياً ولا يمكن استعادته.", "This account was permanently deleted and cannot be restored.")}</Banner>}
          {searchParams.error && searchParams.error !== "deleted" && <Banner tone="bad">{t("تعذر إكمال تسجيل الدخول من الرابط.", "The sign-in link could not be completed.")}</Banner>}
          {searchParams.deleted === "1" && (
            <Banner tone="warn" title={t("حسابك مجدول للحذف", "Your account is scheduled for deletion")}>
              {/^\d{4}-\d{2}-\d{2}$/.test(searchParams.on ?? "")
                ? t(`يُحذف نهائياً في ${fmtDate(searchParams.on, lang)}. سجّل الدخول قبل ذلك التاريخ لإلغاء الحذف.`, `It will be permanently deleted on ${fmtDate(searchParams.on, lang)}. Sign in before then to cancel the deletion.`)
                : t("سجّل الدخول خلال 30 يوماً لإلغاء الحذف.", "Sign in within 30 days to cancel the deletion.")}
            </Banner>
          )}
          <ActionForm action={login} className="stack" resetOnSuccess={false}>
            <input type="hidden" name="next" value={searchParams.next ?? ""} />
            <div className="field"><label htmlFor="email">{t("البريد الإلكتروني", "Email")}</label><input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required dir="ltr" /></div>
            <div className="field"><label htmlFor="password">{t("كلمة المرور", "Password")}</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={PASSWORD_MAX} required dir="ltr" /></div>
            <SubmitButton pending={t("جارٍ الدخول…", "Signing in…")}>{t("دخول", "Sign in")}</SubmitButton>
          </ActionForm>
          <p className="small" style={{ marginBlockStart: "1rem" }}>
            <Link href="/forgot">{t("نسيت كلمة المرور؟", "Forgot your password?")}</Link> · <Link href={searchParams.next ? `/signup?next=${encodeURIComponent(searchParams.next)}` : "/signup"}>{t("إنشاء حساب جديد", "Create an account")}</Link>
          </p>
        </div>
    </AuthShell>
  );
}
