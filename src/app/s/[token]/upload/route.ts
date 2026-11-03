import { NextResponse, type NextRequest } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";
import { clientMeta, getShareSession, validToken } from "@/lib/share";
import { contribState } from "@/lib/share-contrib";
import { EXT, MAX_DOC_BYTES, pdfHasActiveContent, safeFilename, sniffMime } from "@/lib/files";
import { DOC_TYPE } from "@/lib/labels";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";

// Relative Location: behind the host's reverse proxy request.url carries the internal origin.
function back(token: string, params: Record<string, string>) {
  return new NextResponse(null, { status: 303, headers: { Location: `/s/${token}/view?${new URLSearchParams(params).toString()}#contribute`, "Cache-Control": "no-store" } });
}

/** A clinician uploads a document through a contributing share: same byte checks as the patient's own uploads. */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!validToken(token)) return new NextResponse("Not found", { status: 404 });
  const session = getShareSession(token);
  if (!session) return new NextResponse(null, { status: 303, headers: { Location: `/s/${token}` } });
  if (!hasServiceRole()) return back(token, { upload_error: "storage_unconfigured" });
  const st = await contribState(session);
  if (st.status !== "ok" || !st.patient_id || !st.modules?.includes("medical_documents")) return back(token, { upload_error: "forbidden" });
  if (!st.contributor) return back(token, { upload_error: "identify_first" });

  let form: FormData;
  try { form = await request.formData(); } catch { return back(token, { upload_error: "bad_form" }); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back(token, { upload_error: "no_file" });
  if (file.size > MAX_DOC_BYTES) return back(token, { upload_error: "too_large" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) return back(token, { upload_error: "bad_type" });
  if (mime === "application/pdf" && pdfHasActiveContent(bytes)) return back(token, { upload_error: "active_content" });
  const docType = String(form.get("doc_type") ?? "other");
  if (!DOC_TYPE.some((d) => d.value === docType)) return back(token, { upload_error: "bad_form" });
  const title = String(form.get("title") ?? "").trim().slice(0, 200) || safeFilename(file.name);
  const date = String(form.get("document_date") ?? "");
  // the study the file belongs to (the database checks that the link covers it)
  const imaging = String(form.get("imaging_id") ?? "");

  const admin = createAdminClient();
  const path = `${st.patient_id}/${randomUUID()}.${EXT[mime]}`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "0" });
  if (up.error) return back(token, { upload_error: "upload_failed" });
  const { ipHash, ua } = clientMeta();
  const { data, error } = await admin.rpc("share_register_document", {
    p_session_token: session, p_title: title, p_doc_type: docType, p_storage_path: path, p_filename: safeFilename(file.name), p_mime: mime,
    p_size: file.size, p_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_description: String(form.get("description") ?? "").slice(0, 1000) || null,
    p_document_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, p_ip_hash: ipHash, p_user_agent: ua,
    p_imaging: UUID_RE.test(imaging) ? imaging : null,
  });
  const status = (data as { status?: string } | null)?.status;
  if (error || status !== "ok") {
    await admin.storage.from(BUCKET).remove([path]);          // no orphaned files
    return back(token, { upload_error: status ?? "register_failed" });
  }
  return back(token, { uploaded: "1" });
}
