import Link from "next/link";
import { Languages, Moon, Sun } from "lucide-react";
import { NavUser } from "@/components/NavUser";
import { LogoMark, Wordmark } from "@/components/Logo";
import { i18n } from "@/lib/i18n";
import { getTheme } from "@/lib/auth";
import { setLang, setTheme } from "@/app/actions/prefs";

export function Topbar({ signedIn, admin, user }: { signedIn: boolean; admin?: boolean; user?: { name: string; email: string; avatar?: string | null } }) {
  const { lang, t } = i18n();
  const dark = getTheme() === "dark";
  return (
    <header className="topbar no-print">
      <div className="topbar-in">
        <Link href={signedIn ? "/patients" : "/"} className="brand"><LogoMark size={36} /><Wordmark ar="بوابة شفاء" en="Shifa Portal" /></Link>
        <div className="spacer" />
        {signedIn && user ? (
          <>
            <Link href="/patients" className="btn ghost sm topbar-link">{t("المرضى", "Patients")}</Link>
            <NavUser name={user.name} email={user.email} avatar={user.avatar} admin={!!admin} text={{
              patients: t("المرضى", "Patients"), shares: t("سجل المشاركات", "Share register"), account: t("حسابي", "My account"), admin: t("الإدارة", "Admin"), signOut: t("تسجيل الخروج", "Sign out"), menu: t("قائمة الحساب", "Account menu"), sectionAccount: t("الحساب", "Account"), sectionPrefs: t("التفضيلات", "Preferences"), roleLabel: admin ? t("مدير النظام", "Administrator") : t("مستخدم", "Member"), langCode: lang === "ar" ? "AR" : "EN",
              langLabel: lang === "ar" ? "English" : "العربية", nextLang: lang === "ar" ? "en" : "ar",
              themeLabel: dark ? t("المظهر الفاتح", "Light mode") : t("المظهر الداكن", "Dark mode"), nextTheme: dark ? "light" : "dark", dark,
              lang, theme: getTheme(), themeTitle: t("المظهر", "Theme"), themeDark: t("داكن", "Dark"), themeLight: t("فاتح", "Light"), themeSystem: t("حسب النظام", "System"), langTitle: t("اللغة", "Language"),
            }} />
          </>
        ) : (
          <>
            <form action={setLang}>
              <input type="hidden" name="lang" value={lang === "ar" ? "en" : "ar"} />
              <button className="btn ghost sm"><Languages size={16} aria-hidden="true" /><span className="btn-label">{lang === "ar" ? "English" : "العربية"}</span></button>
            </form>
            <form action={setTheme}>
              <input type="hidden" name="theme" value={dark ? "light" : "dark"} />
              <button className="btn ghost sm" aria-label={t("تبديل المظهر", "Toggle theme")}>{dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
