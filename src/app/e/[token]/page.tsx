import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Languages, Siren } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { setLang } from "@/app/actions/prefs";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientMeta } from "@/lib/share";
import { asCard, validEmergencyToken } from "@/lib/care/emergency";
import { LogoMark, Wordmark } from "@/components/Logo";
import { Banner } from "@/components/ui";
import { EmergencyCardView } from "@/components/care/EmergencyCardView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "بطاقة طوارئ طبية", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

/**
 * The public emergency card: no sign-in and no PIN, read-only, and nothing beyond the card fields. The database answers
 * (public.emergency_view, service role only), counts the request against the client address and logs the view.
 */
export default async function PublicEmergency({ params }: { params: { token: string } }) {
  const { lang, t } = i18n();
  if (!validEmergencyToken(params.token)) notFound();
  const { ipHash, ua } = clientMeta();
  const { data, error } = await createAdminClient().rpc("emergency_view", { p_token: params.token, p_ip_hash: ipHash, p_user_agent: ua });
  const r = (data ?? {}) as { status?: string; card?: unknown };
  const card = !error && r.status === "ok" ? asCard(r.card) : null;
  return (
    <>
      <header className="topbar no-print"><div className="topbar-in">
        <span className="brand"><LogoMark size={34} /><Wordmark ar="بوابة شفاء" en="Shifa Portal" /></span>
        <span className="chip bad"><Siren size={13} aria-hidden="true" />{t("بطاقة طوارئ", "Emergency card")}</span>
        <div className="spacer" />
        <form action={setLang}><input type="hidden" name="lang" value={lang === "ar" ? "en" : "ar"} /><button className="btn ghost sm"><Languages size={16} aria-hidden="true" />{lang === "ar" ? "English" : "العربية"}</button></form>
      </div></header>
      <main id="main" className="container narrow">
        {card ? <EmergencyCardView card={card} lang={lang} /> : r.status === "throttled" ? (
          <Banner tone="warn" title={t("محاولات كثيرة", "Too many requests")}>{t("انتظر قليلاً ثم أعد المحاولة.", "Please wait a little and try again.")}</Banner>
        ) : (
          <Banner tone="warn" title={t("الرابط غير متاح", "This link is not available")}>{t("الرابط غير صحيح أو أوقفه صاحب الملف أو جدّده.", "The link is wrong, or the owner switched it off or renewed it.")}</Banner>
        )}
      </main>
    </>
  );
}
