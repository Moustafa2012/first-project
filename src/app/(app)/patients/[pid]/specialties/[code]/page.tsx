import Link from "next/link";
import { appliesToSex, forSex } from "@/lib/sex";
import { notFound } from "next/navigation";
import { Share2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getPatient, getSpecialties, getObsTypes, getAccess } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { ENTITIES } from "@/lib/entities";
import { ALLERGY_SEVERITY, lbl, MED_STATUS } from "@/lib/labels";
import type { ObservationRow } from "@/lib/types";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { SpecialtyIcon } from "@/components/Icon";
import { EntitySection } from "@/components/EntitySection";
import { SpecialtyRecords } from "@/components/SpecialtyRecords";
import { ObservationTable } from "@/components/observations/ObservationTable";

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
  const [access, types] = await Promise.all([getAccess(p.id), getObsTypes()]);
  const supabase = createClient();
  const base = `/patients/${p.id}/specialties/${spec.code}`;
  const typeIds = types.filter((x) => x.default_specialty_id === spec.id).map((x) => x.id);
  const [{ data: allergies }, { data: chronic }, { data: meds }, { data: obs }] = await Promise.all([
    supabase.from("allergies").select("id, substance, severity").eq("patient_id", p.id).eq("status", "active").eq("record_status", "active"),
    supabase.from("conditions").select("id, name, certainty").eq("patient_id", p.id).eq("record_status", "active").in("category", ["chronic", "congenital", "genetic", "disability"]).in("clinical_status", ["active", "recurrence", "inactive", "remission"]),
    supabase.from("medications").select("id, name_generic, name_brand, strength, status").eq("patient_id", p.id).eq("record_status", "active").in("status", ["active", "on_hold"]),
    supabase.from("observations").select("*").eq("patient_id", p.id).in("status", ["final", "preliminary"])
      .or(typeIds.length ? `specialty_id.eq.${spec.id},type_id.in.(${typeIds.join(",")})` : `specialty_id.eq.${spec.id}`).order("effective_at", { ascending: false }).limit(15),
  ]);
  const f = { specialty_id: spec.id };
  const sub = (key: string) => ({ entity: ENTITIES[key], pid: p.id, returnPath: base, filter: f, defaults: f });
  const support = SUPPORT[spec.code];
  return (
    <>
      <PageHead
        title={<span className="row"><SpecialtyIcon name={spec.icon} size={28} />{lang === "ar" ? spec.name_ar : spec.name_en}</span>}
        sub={t(`ملف ${spec.name_ar} للمريض ${p.full_name}`, `${spec.name_en} file for ${p.full_name_en ?? p.full_name}`)}
        actions={access.canShare ? <Link className="btn primary" href={`/patients/${p.id}/sharing/new?specialty=${spec.code}`}><Share2 size={16} aria-hidden="true" />{t("شارك هذا الملف مع طبيب", "Share this file with a doctor")}</Link> : undefined}
      />
      {support && <Banner tone="info"><Link href={`/patients/${p.id}/${support[0]}`}>{t(support[1], support[2])}</Link></Banner>}

      <Card title={t("السياق الصحي المشترك (من الملف الرئيسي)", "Shared health context (from the master record)")}>
        <div className="grid cols-3">
          <div><h3>{t("الحساسية", "Allergies")}</h3>{(allergies ?? []).length === 0
            ? <p className="muted small">{p.allergy_assertion === "none_known" ? t("لا توجد حساسية معروفة", "No known allergies") : t("غير محدد — لا يعني عدم وجودها", "Not stated — not the same as none")}</p>
            : (allergies ?? []).map((a) => <div key={a.id}><Chip tone="bad">{a.substance}</Chip> <span className="small muted">{lbl(ALLERGY_SEVERITY, a.severity, lang)}</span></div>)}</div>
          <div><h3>{t("الأمراض المزمنة / الخلقية", "Chronic / congenital")}</h3>{(chronic ?? []).length === 0 ? <p className="muted small">{t("لا شيء مسجل", "None recorded")}</p> : (chronic ?? []).map((c) => <div key={c.id}>{c.name} {c.certainty !== "confirmed" && <span className="muted small">({t("غير مؤكد", "unconfirmed")})</span>}</div>)}</div>
          <div><h3>{t("الأدوية الحالية", "Current medications")}</h3>{(meds ?? []).length === 0 ? <p className="muted small">{t("لا شيء مسجل", "None recorded")}</p> : (meds ?? []).map((m) => <div key={m.id}>{[m.name_generic ?? m.name_brand, m.strength].filter(Boolean).join(" ")} {m.status !== "active" && <Chip tone="warn">{lbl(MED_STATUS, m.status, lang)}</Chip>}</div>)}</div>
        </div>
        <p className="small muted" style={{ marginBlockStart: ".6rem" }}>{t("تُعدَّل هذه البيانات من أقسامها في الملف الرئيسي فتظهر هنا تلقائياً.", "Edit these in their own sections of the master record; they appear here automatically.")}</p>
      </Card>

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
