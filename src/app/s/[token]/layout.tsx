import type { Metadata } from "next";
import { Languages, Lock } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/Logo";
import { Footer } from "@/components/Footer";
import { i18n } from "@/lib/i18n";
import { setLang } from "@/app/actions/prefs";

export const metadata: Metadata = {
  title: "ملف طبي مشارك",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  const { lang, t } = i18n();
  return (
    <>
      <header className="topbar no-print"><div className="topbar-in">
        <span className="brand"><LogoMark size={34} /><Wordmark ar="بوابة شفاء" en="Shifa Portal" /></span>
        <span className="chip info"><Lock size={13} aria-hidden="true" />{t("ملف طبي مشارك", "Shared medical file")}</span>
        <div className="spacer" />
        <form action={setLang}><input type="hidden" name="lang" value={lang === "ar" ? "en" : "ar"} /><button className="btn ghost sm"><Languages size={16} aria-hidden="true" />{lang === "ar" ? "English" : "العربية"}</button></form>
      </div></header>
      <main id="main" className="container">{children}</main>
      <Footer />
    </>
  );
}
