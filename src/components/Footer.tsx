import { i18n } from "@/lib/i18n";
import { LogoMark } from "@/components/Logo";

export function Footer() {
  const { t } = i18n();
  return (
    <footer className="site-footer no-print">
      <div className="site-footer-in">
        <span className="brand"><LogoMark size={24} /><strong>{t("بوابة شفاء", "Shifa Portal")}</strong></span>
        <span>{t("أداة لتنظيم المعلومات الصحية؛ لا تقدّم تشخيصاً ولا علاجاً. التنبيهات مؤشرات تستدعي تقييم مختص.", "A tool to organise health information; it does not diagnose or treat. Flags are prompts for professional assessment.")}</span>
      </div>
    </footer>
  );
}
