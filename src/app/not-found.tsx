import Link from "next/link";
import { SearchX } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { Topbar } from "@/components/Topbar";

export default function NotFound() {
  const { t } = i18n();
  return (
    <>
      <Topbar signedIn={false} />
      <main id="main" className="container">
        <div className="state-page">
          <div>
            <div className="state-icon"><SearchX size={34} aria-hidden="true" /></div>
            <h1>{t("الصفحة غير موجودة", "Page not found")}</h1>
            <p>{t("ربما انتهت صلاحية الرابط أو لا تملك صلاحية الوصول إلى هذا الملف.", "The link may have expired, or you may not have access to this file.")}</p>
            <Link className="btn primary" href="/">{t("العودة إلى الرئيسية", "Back to home")}</Link>
          </div>
        </div>
      </main>
    </>
  );
}
