import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { getPatient } from "@/lib/data";
import { ENTITIES } from "@/lib/entities";
import { EntitySection } from "@/components/EntitySection";
import { PageHead } from "@/components/ui";

export default async function VisitsPage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const p = await getPatient(params.pid);
  return (
    <>
      <PageHead title={t("الزيارات الطبية", "Visits & encounters")} sub={t("افتح أي زيارة لترى تشخيصاتها وأدويتها وقياساتها ومستنداتها مجتمعة.", "Open a visit to see its diagnoses, medications, measurements and documents together.")} />
      <EntitySection entity={ENTITIES.visits} pid={p.id} returnPath={`/patients/${p.id}/visits`} title={lang === "ar" ? "الزيارات" : "Visits"} compact />
      <p className="muted small"><Link href={`/patients/${p.id}/timeline`}>{t("اعرض كل الأحداث على الخط الزمني", "See everything on the timeline")}</Link></p>
    </>
  );
}
