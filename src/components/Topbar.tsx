import Link from "next/link";
import { Languages, LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { getTheme } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import { setLang, setTheme } from "@/app/actions/prefs";

export function Topbar({ signedIn, admin }: { signedIn: boolean; admin?: boolean }) {
  const { lang, t } = i18n();
  const dark = getTheme() === "dark";
  return (
    <header className="topbar no-print">
      <div className="topbar-in">
        <Link href={signedIn ? "/patients" : "/"} className="brand"><ShieldCheck size={24} aria-hidden="true" />{t("بوابة شفاء", "Shifa Portal")}</Link>
        <div className="spacer" />
        {signedIn && <Link href="/patients" className="btn ghost sm">{t("المرضى", "Patients")}</Link>}
        {signedIn && <Link href="/account" className="btn ghost sm">{t("حسابي", "Account")}</Link>}
        {admin && <Link href="/admin/specialties" className="btn ghost sm">{t("الإدارة", "Admin")}</Link>}
        <form action={setLang}>
          <input type="hidden" name="lang" value={lang === "ar" ? "en" : "ar"} />
          <button className="btn ghost sm"><Languages size={16} aria-hidden="true" />{lang === "ar" ? "English" : "العربية"}</button>
        </form>
        <form action={setTheme}>
          <input type="hidden" name="theme" value={dark ? "light" : "dark"} />
          <button className="btn ghost sm" aria-label={t("تبديل المظهر", "Toggle theme")}>{dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</button>
        </form>
        {signedIn && (
          <form action={logout}>
            <button className="btn ghost sm"><LogOut size={16} aria-hidden="true" />{t("خروج", "Sign out")}</button>
          </form>
        )}
      </div>
    </header>
  );
}
