import { Laptop, Smartphone } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { getTz } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { deviceLabel, parseUserAgent } from "@/lib/device";
import { Card, Chip } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { revokeOtherSessions, revokeSession } from "@/app/actions/sessions";

interface SessionRow { id: string; created_at: string; updated_at: string; user_agent: string | null; is_current: boolean }

/** The account's active sign-ins: which devices, when last used, which one is this; sign one out or all the others. */
export async function SessionsCard() {
  const { lang, t } = i18n();
  const tz = getTz();
  const { data, error } = await createClient().rpc("account_sessions");
  const rows = ((data as SessionRow[] | null) ?? []);
  const others = rows.filter((r) => !r.is_current);
  return (
    <Card id="sessions" title={t("الجلسات النشطة", "Active sessions")}
      description={t("الأجهزة المسجّل دخولها بحسابك الآن. إن رأيت جهازاً لا تعرفه فأنهِ جلسته وغيّر كلمة المرور.", "The devices signed in to your account right now. If you see one you do not know, sign it out and change your password.")}>
      {error ? <p className="form-msg err" role="alert">{t("تعذر تحميل الجلسات.", "Could not load the sessions.")}</p> : (
        <ul className="session-list" aria-label={t("الجلسات النشطة", "Active sessions")}>
          {rows.map((s) => {
            const label = deviceLabel(s.user_agent, t);
            const Icon = parseUserAgent(s.user_agent).mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="session-item" data-current={s.is_current ? "true" : undefined}>
                <Icon size={20} aria-hidden="true" className="session-icon" />
                <div className="session-info">
                  <p className="session-name"><strong>{label}</strong>{s.is_current && <Chip tone="ok">{t("هذا الجهاز", "This device")}</Chip>}</p>
                  <p className="muted small">
                    {t("آخر نشاط", "Last active")} <time dateTime={s.updated_at}>{fmtDateTime(s.updated_at, lang, tz)}</time>
                    {" · "}{t("بدأت", "Started")} <time dateTime={s.created_at}>{fmtDateTime(s.created_at, lang, tz)}</time>
                  </p>
                </div>
                {!s.is_current && (
                  <ActionForm action={revokeSession} className="session-act">
                    <input type="hidden" name="_id" value={s.id} />
                    <SubmitButton className="btn sm" pending={t("جارٍ الإنهاء…", "Signing out…")}>
                      <span aria-hidden="true">{t("إنهاء الجلسة", "Sign out")}</span>
                      <span className="sr-only">{t(`إنهاء جلسة ${label}`, `Sign out the session on ${label}`)}</span>
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!error && others.length > 0 && (
        <ActionForm action={revokeOtherSessions} className="stack">
          <div><ConfirmButton className="btn danger sm" message={t("إنهاء كل الجلسات الأخرى؟ سيحتاج كل جهاز آخر إلى تسجيل الدخول من جديد.", "Sign out every other session? Each other device will have to sign in again.")}>
            {t("إنهاء كل الجلسات الأخرى", "Sign out all other sessions")}
          </ConfirmButton></div>
        </ActionForm>
      )}
      {!error && others.length === 0 && <p className="muted small">{t("لا توجد جلسات أخرى.", "There are no other sessions.")}</p>}
    </Card>
  );
}
