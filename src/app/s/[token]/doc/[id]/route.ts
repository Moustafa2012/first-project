import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getShareSession, clientMeta, validToken } from "@/lib/share";
import { serveStoredFile } from "@/lib/storage";
import { UUID_RE } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Document access for a doctor: authorised by the database for this exact session, then streamed. */
export async function GET(request: NextRequest, { params }: { params: { token: string; id: string } }) {
  if (!validToken(params.token) || !UUID_RE.test(params.id)) return new NextResponse("Not found", { status: 404 });
  const session = getShareSession(params.token);
  if (!session) return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { ipHash, ua } = clientMeta();
  const { data } = await createAdminClient().rpc("share_document", { p_session_token: session, p_document: params.id, p_ip_hash: ipHash, p_user_agent: ua });
  const r = data as { status: string; storage_path?: string; mime_type?: string; filename?: string; allow_download?: boolean } | null;
  if (!r || r.status === "expired") return new NextResponse("Session expired", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (r.status !== "ok" || !r.storage_path) return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const wantDownload = request.nextUrl.searchParams.get("dl") === "1";
  if (wantDownload && !r.allow_download) return new NextResponse("Download is not permitted for this share", { status: 403 });
  return serveStoredFile(r.storage_path, r.mime_type ?? "application/octet-stream", r.filename ?? "document", wantDownload);
}
