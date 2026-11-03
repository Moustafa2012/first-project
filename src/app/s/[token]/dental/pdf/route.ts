import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientMeta, getShareSession, validToken } from "@/lib/share";
import { getTz } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { localDate } from "@/lib/format";
import { getProcedureCatalog } from "@/lib/data";
import { buildDentalSummary } from "@/lib/dental-summary";
import { mergeShareDental, type ShareExamExtras, type ShareImagingExtras } from "@/lib/share-dental";
import { buildDentalSummaryReport } from "@/lib/pdf/dental-summary-report";
import { pdfResponse } from "@/lib/pdf/respond";
import type { PdfPatient } from "@/lib/pdf/rx-reports";
import type { Bundle, ShareDental, ShareRecall, SharePerio } from "@/lib/share-types";
import type { ClinicalContextData } from "@/lib/clinical-context";
import { activeDrugNames, type Rx } from "@/lib/prescription";
import { evaluateSafety } from "@/lib/safety-rules";
import { getSafetyRulesForShare, shareSafetyFacts } from "@/lib/safety-server";
import { OPEN_ITEM, OPEN_PLAN } from "@/lib/treatment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The dental summary of this share as a PDF, only when the patient allowed printing (the same rule as the shared file's PDF). It is built
 *  from the same share functions as the on-screen view, so it holds exactly what this link may show; the database re-checks
 *  revocation, expiry and scope on every request. */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  if (!validToken(params.token)) return new NextResponse("Not found", { status: 404 });
  const session = getShareSession(params.token);
  if (!session) return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { ipHash, ua } = clientMeta();
  const admin = createAdminClient();
  const { data } = await admin.rpc("share_bundle", { p_session_token: session, p_ip_hash: ipHash, p_user_agent: ua });
  const b = data as (Bundle | { status: string }) | null;
  if (!b || b.status !== "ok") return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  const bundle = b as Bundle;
  if (!bundle.meta.allow_print) return new NextResponse("Printing is not permitted for this share", { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const [{ data: dental }, { data: examExtras }, { data: imgExtras }, { data: perioData }, { data: recalls }, { data: context }, { data: rxData }, rules, catalog] = await Promise.all([
      admin.rpc("share_dental", { p_session_token: session }), admin.rpc("share_dental_exam_extras", { p_session_token: session }),
      admin.rpc("share_dental_imaging_extras", { p_session_token: session }), admin.rpc("share_perio", { p_session_token: session }),
      admin.rpc("share_recalls", { p_session_token: session }), admin.rpc("share_context", { p_session_token: session }),
      admin.rpc("share_rx_extras", { p_session_token: session }), getSafetyRulesForShare(), getProcedureCatalog(),
    ]);
    const dent = dental as ShareDental | null;
    if (dent?.status !== "ok") return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    mergeShareDental(dent, examExtras as ShareExamExtras, imgExtras as ShareImagingExtras);
    const perio = perioData as SharePerio | null;
    const ctx = context as (ClinicalContextData & { status: string; specialties: string[] | null }) | null;
    const rxx = rxData as { status: string; prescriptions?: Rx[] } | null;
    const category = new Map(catalog.map((c) => [c.code, c.category]));
    const facts = shareSafetyFacts(bundle);
    const alerts = ctx?.status === "ok"
      ? evaluateSafety(rules, {
          context: ctx, labs: facts.labs, history: facts.history, drugs: activeDrugNames(rxx?.status === "ok" ? rxx.prescriptions ?? [] : []), specialties: ctx.specialties ?? "all",
          items: (dent.plans ?? []).filter((pl) => OPEN_PLAN.has(pl.status)).flatMap((pl) => pl.items.filter((i) => OPEN_ITEM.has(i.status))
            .map((i) => ({ id: i.id, name: i.name, catalog_code: i.catalog_code, category: category.get(i.catalog_code ?? "") ?? null, teeth: i.teeth, plan: pl.title }))),
        })
      : [];
    const { lang } = i18n();
    const tz = getTz();
    const summary = buildDentalSummary({
      today: localDate(new Date(), tz), exams: dent.exams, findings: dent.findings, pulp: dent.pulp, images: dent.imaging, perio: perio?.status === "ok" ? perio.exams : [],
      plans: dent.plans, recalls: (recalls ?? []) as ShareRecall[], safety: alerts,
    });
    const pt = bundle.patient;
    const patient: PdfPatient = { mrn: pt.mrn, full_name: pt.full_name, full_name_en: pt.full_name_en, date_of_birth: pt.date_of_birth, sex: pt.sex, nationality: pt.nationality, blood: pt.blood_group, verified: pt.blood_group_verified, phone: pt.phone };
    const { meta, blocks, filename } = buildDentalSummaryReport(patient, summary, { lang, tz, alerts, byShare: true, clinician: bundle.meta.recipient_label });
    return await pdfResponse(meta, blocks, filename, {}, request.nextUrl.searchParams.get("dl") === "1");
  } catch (e) {
    console.error("[pdf-error]", String((e as Error)?.message ?? e).slice(0, 300));
    return new NextResponse("Could not create the PDF", { status: 500 });
  }
}
