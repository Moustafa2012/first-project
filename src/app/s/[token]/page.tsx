import { notFound } from "next/navigation";
import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { getShareSession, validToken } from "@/lib/share";
import { Banner } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { openShare } from "@/app/actions/share-viewer";

export const dynamic = "force-dynamic";

export default function ShareGate({ params, searchParams }: { params: { token: string }; searchParams: { expired?: string; ended?: string } }) {
  const { t } = i18n();
  if (!validToken(params.token)) notFound();
  const hasSession = Boolean(getShareSession(params.token));
  return (
    <div className="container narrow" style={{ padding: 0 }}>
      <div className="card auth-card">
        <h1>{t("ملف طبي مشارك", "Shared medical file")}</h1>
        <p className="muted">{t("أدخل رمز PIN المكوّن من 6 أرقام الذي وصلك من المريض لفتح الملف.", "Enter the 6-digit PIN the patient gave you to open the file.")}</p>
        {searchParams.expired && <Banner tone="warn">{t("انتهت الجلسة أو المشاركة. أدخل الرمز من جديد إن كانت المشاركة سارية.", "The session or share has ended. Enter the PIN again if the share is still valid.")}</Banner>}
        {searchParams.ended && <Banner tone="ok">{t("أنهيت الجلسة.", "Session ended.")}</Banner>}
        <ActionForm action={openShare} className="stack" resetOnSuccess={false}>
          <input type="hidden" name="_t" value={params.token} />
          <div className="field">
            <label htmlFor="pin" className="sr-only">PIN</label>
            <input id="pin" name="pin" className="pin-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus placeholder="••••••" aria-label="PIN" />
          </div>
          <SubmitButton pending={t("جارٍ التحقق…", "Verifying…")}>{t("فتح الملف", "Open file")}</SubmitButton>
        </ActionForm>
        {hasSession && <p className="small" style={{ marginBlockStart: "1rem" }}><Link href={`/s/${params.token}/view`}>{t("متابعة الجلسة الحالية", "Continue the current session")}</Link></p>}
        <p className="small muted" style={{ marginBlockStart: "1rem" }}>{t("الوصول مسجّل. الرابط محدد المدة وقد يُلغى في أي لحظة من المريض.", "Access is logged. The link is time-limited and the patient can revoke it at any moment.")}</p>
      </div>
    </div>
  );
}
