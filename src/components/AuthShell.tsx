import { Lock, Share2, ShieldCheck } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";

/** Split-screen frame for sign in / sign up / reset: brand story on one side, the form on the other. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = i18n();
  const points = [
    [ShieldCheck, t("ملف صحي موحد لكل فرد من العائلة، بمصدر وتوثيق لكل معلومة.", "One health file per family member, with provenance on every entry.")],
    [Share2, t("شارك مع طبيبك ما تختاره فقط: رابط + PIN، مدة محددة، وإلغاء فوري.", "Share only what you choose: link + PIN, set expiry, instant revoke.")],
    [Lock, t("بياناتك معزولة عن غيرك، وكل وصول مسجّل ويمكن مراجعته.", "Your data is isolated from everyone else's, and every access is logged.")],
  ] as const;
  return (
    <>
      <Topbar signedIn={false} />
      <main id="main" className="auth-wrap">
        <aside className="auth-side" aria-hidden="false">
          <h2>{t("سجلك الصحي، بين يديك وبأمان", "Your health record, in your hands and secure")}</h2>
          <p>{t("تتبّع القياسات والتحاليل والأدوية والزيارات في مكان واحد.", "Track measurements, tests, medications and visits in one place.")}</p>
          <ul>{points.map(([I, text], i) => <li key={i}><I size={18} aria-hidden="true" /><span>{text}</span></li>)}</ul>
        </aside>
        <div className="auth-main">{children}</div>
      </main>
      <Footer />
    </>
  );
}
