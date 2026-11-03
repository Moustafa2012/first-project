import Link from "next/link";
import { appliesToSex, forSex } from "@/lib/sex";
import { notFound, redirect } from "next/navigation";
import { Share2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getPatient, getSpecialties, getObsTypes, getAccess } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { ENTITIES } from "@/lib/entities";
import type { ObservationRow } from "@/lib/types";
import { Banner, Card, Empty, PageHead } from "@/components/ui";
import { SpecialtyIcon } from "@/components/Icon";
import { EntitySection } from "@/components/EntitySection";
import { SpecialtyRecords } from "@/components/SpecialtyRecords";
import { ObservationTable } from "@/components/observations/ObservationTable";
import { ClinicalContext } from "@/components/ClinicalContext";
import { getClinicalContext } from "@/lib/clinical-context-server";

const SUPPORT: Record<string, [string, string, string]> = {
  laboratory: ["labs", "افتح صفحة التحاليل المخبرية", "Open lab results"],
  radiology: ["imaging", "افتح الأشعة والتصوير", "Open imaging"],
  pharmacy: ["medications", "افتح الأدوية", "Open medications"],
  immunization: ["immunizations", "افتح التطعيمات", "Open immunizations"],
  medical_reports: ["documents", "افتح المستندات", "Open documents"],
  external_records: ["documents", "افتح المستندات", "Open documents"],
};

export default async function SpecialtyPage({ params }: { params: { pid: string; code: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const specs = await getSpecialties();
  const spec = specs.find((s) => s.code === params.code && appliesToSex(s.applicable_sex, p.sex));
  if (!spec) notFound();
  // dentistry has one workspace: the dental file (chart, problems, visits & procedures, images, profile)
  if (spec.code === "dentistry") redirect(`/patients/${p.id}/dental`);
  const [access, types] = await Promise.all([getAccess(p.id), getObsTypes()]);
  const supabase = createClient();
  const base = `/patients/${p.id}/specialties/${spec.code}`;
  const typeIds = types.filter((x) => x.default_specialty_id === spec.id).map((x) => x.id);
  const [ctx, { data: obs }] = await Promise.all([
    getClinicalContext(p.id),
    supabase.from("observations").select("*").eq("patient_id", p.id).in("status", ["final", "preliminary"])
      .or(typeIds.length ? `specialty_id.eq.${spec.id},type_id.in.(${typeIds.join(",")})` : `specialty_id.eq.${spec.id}`).order("effective_at", { ascending: false }).limit(15),
  ]);
  const f = { specialty_id: spec.id };
  // inside a specialty its forms never ask for the specialty; the dental-only fields appear in dentistry
  const sub = (key: string) => ({ entity: ENTITIES[key], pid: p.id, returnPath: base, filter: f, context: { fixed: f, dental: spec.code === "dentistry" } });
  const support = SUPPORT[spec.code];
  return (
    <>
      <PageHead
        title={<span className="row"><SpecialtyIcon name={spec.icon} size={28} />{lang === "ar" ? spec.name_ar : spec.name_en}</span>}
        sub={t(`ملف ${spec.name_ar} للمريض ${p.full_name}`, `${spec.name_en} file for ${p.full_name_en ?? p.full_name}`)}
        actions={access.canShare ? <Link className="btn primary" href={`/patients/${p.id}/sharing/new?specialty=${spec.code}`}><Share2 size={16} aria-hidden="true" />{t("شارك هذا الملف مع طبيب", "Share this file with a doctor")}</Link> : undefined}
      />
      {support && <Banner tone="info"><Link href={`/patients/${p.id}/${support[0]}`}>{t(support[1], support[2])}</Link></Banner>}

      <ClinicalContext ctx={ctx} lang={lang} tz={tz} codes={[spec.code]} coreHref={`/patients/${p.id}/profile`} />

      <SpecialtyRecords pid={p.id} specialtyId={spec.id} returnPath={base} />
      <EntitySection {...sub("visits")} title={t("الزيارات", "Visits")} compact />
      <EntitySection {...sub("conditions")} title={t("التشخيصات والحالات في هذا القسم", "Diagnoses & conditions in this specialty")} compact />
      <Card title={t("قياسات ونتائج ذات صلة", "Related measurements & results")}>
        {(obs ?? []).length === 0 ? <Empty>{t("لا توجد قياسات مرتبطة بهذا القسم.", "No measurements linked to this specialty.")}</Empty> :
          <ObservationTable rows={obs as ObservationRow[]} lang={lang} tz={tz} canWrite={false} pid={p.id} returnPath={base} />}
      </Card>
      <EntitySection {...sub("procedures")} title={t("الإجراءات والعمليات", "Procedures")} compact />
      <EntitySection {...sub("imaging")} title={t("الأشعة والتصوير", "Imaging")} compact />
      <EntitySection {...sub("medications")} title={t("أدوية هذا القسم", "Medications for this specialty")} compact />
      <EntitySection {...sub("care-plans")} title={t("خطط المتابعة", "Care plans")} compact />
      <EntitySection {...sub("appointments")} title={t("المواعيد", "Appointments")} compact />
      <EntitySection {...sub("notes")} title={t("ملاحظات الطبيب", "Clinical notes")} compact />
      <p className="small muted"><Link href={`/patients/${p.id}/documents?specialty=${spec.id}`}>{t("مستندات هذا القسم", "Documents of this specialty")}</Link></p>
    </>
  );
}
