import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { getPatient } from "@/lib/data";
import { ENTITIES, GENERIC_SLUGS } from "@/lib/entities";
import { EntitySection } from "@/components/EntitySection";
import { PageHead } from "@/components/ui";

export default async function EntityPage({ params }: { params: { pid: string; slug: string } }) {
  const def = ENTITIES[params.slug];
  if (!def || !GENERIC_SLUGS.includes(params.slug)) notFound();
  const { lang, t } = i18n();
  const p = await getPatient(params.pid);
  const sub: Record<string, [string, string]> = {
    conditions: ["الأمراض المزمنة والخلقية والتشخيصات، مع حالتها ودرجة التأكد منها.", "Chronic, congenital conditions and diagnoses with their status and certainty."],
    allergies: ["سجّل كل حساسية بتفاصيلها. غياب السجل لا يعني غياب الحساسية: حدّد الحالة صراحةً من البيانات الشخصية.", "Record each allergy in detail. No entries does not mean no allergies — state it explicitly in personal details."],
    medications: ["ميّز بين الموصوف وما يذكره المريض، وغيّر الحالة عند الإيقاف.", "Separate prescribed from patient-reported, and update the status when stopped."],
  };
  return (
    <>
      <PageHead title={lang === "ar" ? def.ar : def.en} sub={sub[def.slug] ? t(...sub[def.slug]) : undefined} />
      <EntitySection entity={def} pid={p.id} returnPath={`/patients/${p.id}/${def.slug}`} title={lang === "ar" ? def.ar : def.en} />
    </>
  );
}
