import { i18n } from "@/lib/i18n";
import { getTz } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { deviceLabel } from "@/lib/device";
import { Card, Chip } from "@/components/ui";

interface EventRow { id: number; at: string; kind: string; user_agent: string | null }

/** Recent sign-ins and security events of the account: time and an approximate device. Private to the account. */
export async function ActivityCard() {
  const { lang, t } = i18n();
  const tz = getTz();
  const { data } = await createClient().from("account_events").select("id, at, kind, user_agent").order("at", { ascending: false }).order("id", { ascending: false }).limit(12);
  const rows = (data as EventRow[] | null) ?? [];
  const KIND: Record<string, [string, "ok" | "info" | "warn" | "bad" | "muted"]> = {
    sign_in: [t("تسجيل دخول", "Signed in"), "info"],
    password_changed: [t("تغيير كلمة المرور", "Password changed"), "warn"],
    session_revoked: [t("إنهاء جلسة", "A session was signed out"), "muted"],
    sessions_revoked: [t("إنهاء كل الجلسات الأخرى", "All other sessions signed out"), "muted"],
    deletion_requested: [t("طلب حذف الحساب", "Account deletion requested"), "bad"],
    deletion_cancelled: [t("إلغاء حذف الحساب (بتسجيل الدخول)", "Account deletion cancelled (by signing in)"), "ok"],
  };
  return (
    <Card id="activity" title={t("النشاط الأخير على الحساب", "Recent account activity")}
      description={t("آخر عمليات الدخول والتغييرات الأمنية، بوقتها والجهاز التقريبي. لا يراها غيرك.", "The latest sign-ins and security changes, with the time and the approximate device. Only you can see this.")}>
      {rows.length === 0 ? <p className="muted small">{t("لا نشاط مسجّل بعد.", "No activity recorded yet.")}</p> : (
        <ul className="activity-list" aria-label={t("النشاط الأخير على الحساب", "Recent account activity")}>
          {rows.map((e) => {
            const [label, tone] = KIND[e.kind] ?? [e.kind, "muted" as const];
            return (
              <li key={e.id}>
                <Chip tone={tone}>{label}</Chip>
                {e.user_agent && <span className="small">{deviceLabel(e.user_agent, t)}</span>}
                <time className="muted small ltr" dateTime={e.at}>{fmtDateTime(e.at, lang, tz)}</time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
