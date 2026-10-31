import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientMeta, getShareSession, validToken } from "@/lib/share";
import { getTz } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { buildShareReport } from "@/lib/pdf/reports";
import { pdfResponse } from "@/lib/pdf/respond";
import type { Bundle } from "@/lib/share-types";
import type { ClinicalContextData } from "@/lib/clinical-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF of exactly what this doctor session may see, only when the patient allowed printing. The database re-checks
 *  revocation, expiry and scope for this request (same call as the on-screen view). */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  if (!validToken(params.token)) return new NextResponse("Not found", { status: 404 });
  const session = getShareSession(params.token);
  if (!session) return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { ipHash, ua } = clientMeta();
  const { data } = await createAdminClient().rpc("share_bundle", { p_session_token: session, p_ip_hash: ipHash, p_user_agent: ua });
  const b = data as (Bundle | { status: string }) | null;
  if (!b || b.status !== "ok") return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  const bundle = b as Bundle;
  if (!bundle.meta.allow_print) return new NextResponse("Printing is not permitted for this share", { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const { lang } = i18n();
    const { data: context } = await createAdminClient().rpc("share_context", { p_session_token: session });
    const ctx = context as (ClinicalContextData & { status: string; specialties: string[] | null }) | null;
    const { meta, blocks, filename } = buildShareReport(bundle, { lang, tz: getTz(), ctx: ctx?.status === "ok" ? ctx : null });
    return await pdfResponse(meta, blocks, filename, {}, request.nextUrl.searchParams.get("dl") === "1");
  } catch (e) {
    console.error("[pdf-error]", String((e as Error)?.message ?? e).slice(0, 300));
    return new NextResponse("Could not create the PDF", { status: 500 });
  }
}
