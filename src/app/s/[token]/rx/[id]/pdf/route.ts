import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientMeta, getShareSession, validToken } from "@/lib/share";
import { getTz } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";
import { buildPrescriptionReport, type PdfPatient } from "@/lib/pdf/rx-reports";
import { pdfResponse } from "@/lib/pdf/respond";
import type { Bundle } from "@/lib/share-types";
import type { ClinicalContextData } from "@/lib/clinical-context";
import type { Rx } from "@/lib/prescription";
import { evaluateSafety } from "@/lib/safety-rules";
import { getSafetyRulesForShare, shareSafetyFacts } from "@/lib/safety-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A prescription of this share as a PDF, only when the patient allowed printing (the same rule as the shared file's PDF). The
 *  database re-checks revocation, expiry and scope: only prescriptions inside the share's scope are found. */
export async function GET(request: NextRequest, { params }: { params: { token: string; id: string } }) {
  if (!validToken(params.token) || !UUID_RE.test(params.id)) return new NextResponse("Not found", { status: 404 });
  const session = getShareSession(params.token);
  if (!session) return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { ipHash, ua } = clientMeta();
  const admin = createAdminClient();
  const { data } = await admin.rpc("share_bundle", { p_session_token: session, p_ip_hash: ipHash, p_user_agent: ua });
  const b = data as (Bundle | { status: string }) | null;
  if (!b || b.status !== "ok") return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  const bundle = b as Bundle;
  if (!bundle.meta.allow_print) return new NextResponse("Printing is not permitted for this share", { status: 403, headers: { "Cache-Control": "no-store" } });
  const { data: extras } = await admin.rpc("share_rx_extras", { p_session_token: session });
  const rx = ((extras as { status?: string; prescriptions?: Rx[] } | null)?.prescriptions ?? []).find((x) => x.id === params.id);
  if (!rx) return new NextResponse("Not found", { status: 404 });
  try {
    const { lang } = i18n();
    const p = bundle.patient;
    const patient: PdfPatient = {
      mrn: p.mrn, full_name: p.full_name, full_name_en: p.full_name_en, date_of_birth: p.date_of_birth, sex: p.sex, nationality: p.nationality, blood: p.blood_group,
      verified: p.blood_group_verified, phone: p.phone,
    };
    const { data: context } = await admin.rpc("share_context", { p_session_token: session });
    const ctx = context as (ClinicalContextData & { status: string }) | null;
    const facts = shareSafetyFacts(bundle);
    const alerts = ctx?.status === "ok"
      ? evaluateSafety(await getSafetyRulesForShare(), {
          context: ctx, drugs: rx.lines.flatMap((l) => [l.name_generic, l.name_brand].filter((x): x is string => Boolean(x))), labs: facts.labs, history: facts.history, specialties: "all",
        }).filter((a) => a.drugs.length > 0)
      : [];
    const { meta, blocks, filename } = buildPrescriptionReport(patient, rx, { lang, tz: getTz(), allergies: bundle.allergies.map((a) => String(a.substance)), alerts, byShare: true });
    return await pdfResponse(meta, blocks, filename, {}, request.nextUrl.searchParams.get("dl") === "1");
  } catch (e) {
    console.error("[pdf-error]", String((e as Error)?.message ?? e).slice(0, 300));
    return new NextResponse("Could not create the PDF", { status: 500 });
  }
}
