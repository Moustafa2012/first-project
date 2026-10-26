import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getPatient, getSpecialties } from "@/lib/data";
import { Card, Chip, PageHead } from "@/components/ui";
import { SpecialtyIcon } from "@/components/Icon";

const TABLES = ["encounters", "conditions", "procedures", "imaging_studies", "medical_documents", "specialty_records", "clinical_notes", "care_plans", "medications", "observations"];

export default async function SpecialtiesPage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const p = await getPatient(params.pid);
  const specs = await getSpecialties();
  const supabase = createClient();
  const results = await Promise.all(TABLES.map((tb) => {
    let q = supabase.from(tb).select("specialty_id").eq("patient_id", p.id).not("specialty_id", "is", null).limit(5000);
    q = tb === "observations" ? q.in("status", ["final", "preliminary"]) : q.eq("record_status", "active");
    return q;
  }));
  const counts = new Map<string, number>();
  for (const r of results) for (const row of (r.data ?? []) as { specialty_id: string }[]) counts.set(row.specialty_id, (counts.get(row.specialty_id) ?? 0) + 1);
  const groups: [string, "clinical" | "support"][] = [[t("التخصصات الطبية", "Medical specialties"), "clinical"], [t("الأقسام المساندة", "Supporting departments"), "support"]];
  return (
    <>
      <PageHead title={t("ملفات الأقسام الطبية", "Specialty files")} sub={t("لكل قسم ملفه الخاص (زياراته، نتائجه، مستنداته، خطته). الحساسية والأمراض المزمنة والأدوية تظهر في كل قسم من الملف الرئيسي دون نسخها.", "Each specialty has its own file. Allergies, chronic conditions and medications appear in every file from the master record — never copied.")} />
      {groups.map(([title, kind]) => (
        <Card key={kind} title={title}>
          <div className="grid cols-3">
            {specs.filter((s) => s.kind === kind).map((s) => {
              const n = counts.get(s.id) ?? 0;
              return (
                <Link key={s.id} href={`/patients/${p.id}/specialties/${s.code}`} className="tile" style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="row between"><span className="row"><SpecialtyIcon name={s.icon} size={22} /><strong>{lang === "ar" ? s.name_ar : s.name_en}</strong></span>
                    <Chip tone={n ? "info" : "muted"}>{n} {t("سجل", "records")}</Chip></div>
                </Link>
              );
            })}
          </div>
        </Card>
      ))}
    </>
  );
}
