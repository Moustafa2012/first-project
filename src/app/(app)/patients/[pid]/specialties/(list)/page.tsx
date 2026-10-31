import Link from "next/link";
import { forSex } from "@/lib/sex";
import { i18n } from "@/lib/i18n";
import { getPatient, getSpecialties, getSpecialtyUsage } from "@/lib/data";
import type { Specialty } from "@/lib/types";
import { Card, Chip, PageHead } from "@/components/ui";
import { SpecialtyIcon } from "@/components/Icon";

export default async function SpecialtiesPage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const [p, specs, used] = await Promise.all([getPatient(params.pid), getSpecialties(), getSpecialtyUsage(params.pid)]);
  const counts = new Map(used.map((u) => [u.specialty_id, u.n]));
  const all = forSex(specs, p.sex);
  // the specialties this file uses come first (most used first); the others wait behind "open another specialty"
  const inUse = used.map((u) => all.find((s) => s.id === u.specialty_id)).filter((s): s is Specialty => !!s);
  const rest = all.filter((s) => !counts.has(s.id));
  const href = (s: Specialty) => (s.code === "dentistry" ? `/patients/${p.id}/dental` : `/patients/${p.id}/specialties/${s.code}`);
  const tile = (s: Specialty) => {
    const n = counts.get(s.id) ?? 0;
    return (
      <Link key={s.id} href={href(s)} className="tile" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="row between"><span className="row"><SpecialtyIcon name={s.icon} size={22} /><strong>{lang === "ar" ? s.name_ar : s.name_en}</strong></span>
          {n > 0 && <Chip tone="info">{n} {t("سجل", "records")}</Chip>}</div>
      </Link>
    );
  };
  const groups: [string, "clinical" | "support"][] = [[t("التخصصات الطبية", "Medical specialties"), "clinical"], [t("الأقسام المساندة", "Supporting departments"), "support"]];
  return (
    <>
      <PageHead title={t("الأقسام الطبية", "Specialty files")} sub={t("لكل قسم ملفه الخاص (زياراته، نتائجه، مستنداته، خطته). الحساسية والأمراض المزمنة والأدوية تظهر في كل قسم من الملف الأساسي دون نسخها.", "Each specialty has its own file. Allergies, chronic conditions and medications appear in every file from the core file — never copied.")} />
      <Card title={t("الأقسام المستخدمة في هذا الملف", "Specialties used in this file")} id="used">
        {inUse.length === 0
          ? <p className="muted small">{t("لم يُسجَّل شيء في أي قسم بعد. افتح القسم الذي تحتاجه من القائمة أدناه.", "Nothing recorded in any specialty yet. Open the one you need from the list below.")}</p>
          : <div className="grid cols-3">{inUse.map(tile)}</div>}
      </Card>
      <Card title={t("فتح قسم آخر", "Open another specialty")} id="others">
        <details className="fold" open={inUse.length === 0}>
          <summary>{t(`كل الأقسام الأخرى (${rest.length})`, `All other specialties (${rest.length})`)}</summary>
          <div className="fold-body stack">
            {groups.map(([title, kind]) => {
              const list = rest.filter((s) => s.kind === kind);
              return list.length ? <div key={kind}><h3>{title}</h3><div className="grid cols-3">{list.map(tile)}</div></div> : null;
            })}
          </div>
        </details>
      </Card>
    </>
  );
}
