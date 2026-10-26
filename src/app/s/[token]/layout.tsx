import type { Metadata } from "next";
import { Languages, ShieldCheck } from "lucide-react";
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
        <span className="brand"><ShieldCheck size={22} aria-hidden="true" />{t("بوابة شفاء — ملف طبي مشارك", "Shifa Portal — shared medical file")}</span>
        <div className="spacer" />
        <form action={setLang}><input type="hidden" name="lang" value={lang === "ar" ? "en" : "ar"} /><button className="btn ghost sm"><Languages size={16} aria-hidden="true" />{lang === "ar" ? "English" : "العربية"}</button></form>
      </div></header>
      <main className="container">{children}</main>
    </>
  );
}
