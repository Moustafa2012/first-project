import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { localDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ENTITIES, GENERIC_SLUGS } from "@/lib/entities";
import { EntitySection } from "@/components/EntitySection";
import { Card, PageHead } from "@/components/ui";
import { Prescriptions } from "@/components/rx/Prescriptions";
import { RxForm } from "@/components/rx/RxForm";
import { groupPrescriptions } from "@/lib/prescription";
import { createPrescription, invalidatePrescription, setPrescriptionStatus } from "@/app/actions/prescriptions";

export default async function EntityPage({ params }: { params: { pid: string; slug: string } }) {
  const def = ENTITIES[params.slug];
  if (!def || !GENERIC_SLUGS.includes(params.slug)) notFound();
  const { lang, t } = i18n();
  const p = await getPatient(params.pid);
  const sub: Record<string, [string, string]> = {
    conditions: ["الأمراض المزمنة والخلقية والتشخيصات، مع حالتها ودرجة التأكد منها.", "Chronic, congenital conditions and diagnoses with their status and certainty."],
    allergies: ["سجّل كل حساسية بتفاصيلها. غياب السجل لا يعني غياب الحساسية: حدّد الحالة صراحةً من البيانات الشخصية.", "Record each allergy in detail. No entries does not mean no allergies: state it explicitly in the personal details."],
    medications: ["ميّز بين الموصوف وما يذكره المريض، وغيّر الحالة عند الإيقاف.", "Separate prescribed from patient-reported, and update the status when stopped."],
  };
  const rx = params.slug === "medications" ? await prescriptionsOf(p.id) : null;
  return (
    <>
      <PageHead title={lang === "ar" ? def.ar : def.en} sub={sub[def.slug] ? t(...sub[def.slug]) : undefined} />
      {rx && (
        <Card id="prescriptions" title={t("الوصفات الطبية", "Prescriptions")}>
          <p className="small muted" style={{ marginBlockStart: 0 }}>{t("وصفة تجمع عدة أدوية بجرعتها ومدتها وكميتها. تُضاف أدويتها إلى القائمة أدناه دفعة واحدة، ويمكن طباعتها.",
            "A prescription groups several medicines with their dose, duration and quantity. Its medicines are added to the list below in one step, and it can be printed.")}</p>
          <Prescriptions rxs={rx.list} lang={lang} tz={getTz()} contributors={rx.contributors}
            actions={{ hidden: { _pid: p.id }, ...(rx.canWrite ? { status: setPrescriptionStatus, invalidate: invalidatePrescription } : {}), pdfHref: (r) => `/api/patients/${p.id}/prescriptions/${r.id}/pdf` }} />
          {rx.canWrite && (
            <details className="fold" id="new-rx">
              <summary>{t("وصفة جديدة", "A new prescription")}</summary>
              <div className="fold-body">
                <RxForm action={createPrescription} hidden={{ _pid: p.id }} lang={lang} today={localDate(new Date(), getTz())} idPrefix="mrx" submitLabel={t("حفظ الوصفة", "Save the prescription")} />
              </div>
            </details>
          )}
        </Card>
      )}
      <EntitySection entity={def} pid={p.id} returnPath={`/patients/${p.id}/${def.slug}`} title={lang === "ar" ? def.ar : def.en} />
    </>
  );
}

/** Every prescription of the file with its medicines, and who may write one. */
async function prescriptionsOf(pid: string) {
  const supabase = createClient();
  const [access, { data: rows }, { data: ctr }] = await Promise.all([
    getAccess(pid),
    supabase.from("prescriptions").select("*").eq("patient_id", pid).eq("record_status", "active").order("issued_on", { ascending: false }).order("recorded_at", { ascending: false }),
    supabase.from("share_contributors").select("id, full_name").eq("patient_id", pid),
  ]);
  const ids = (rows ?? []).map((r) => r.id as string);
  const { data: meds } = ids.length
    ? await supabase.from("medications").select("*").eq("patient_id", pid).eq("record_status", "active").in("prescription_id", ids)
    : { data: [] as Record<string, unknown>[] };
  return {
    list: groupPrescriptions((rows ?? []) as Record<string, unknown>[], (meds ?? []) as Record<string, unknown>[]),
    canWrite: access.canWrite, contributors: Object.fromEntries((ctr ?? []).map((c) => [c.id as string, c.full_name as string])),
  };
}
