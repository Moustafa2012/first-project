import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";
import { UUID_RE } from "@/lib/data";
import { EXT, MAX_DOC_BYTES, pdfHasActiveContent, safeFilename, sniffMime } from "@/lib/files";
import { DOC_TYPE, SENSITIVITY } from "@/lib/labels";

export const runtime = "nodejs";

// Relative Location: behind a reverse proxy request.url carries the internal origin (0.0.0.0:3000).
function back(_request: NextRequest, pid: string, params: Record<string, string>, to?: string) {
  const qs = new URLSearchParams(params).toString();
  // an image attached from the dental page goes back there (only to a page of this patient's own file)
  const path = to && to.startsWith(`/patients/${pid}/`) && /^[\w/?=&.-]+$/.test(to) && !to.includes("//") ? to : `/patients/${pid}/documents`;
  return new NextResponse(null, { status: 303, headers: { Location: `${path}${qs ? `${path.includes("?") ? "&" : "?"}${qs}` : ""}` } });
}

/** Validates the bytes, stores the file in the private bucket, then registers it as the signed-in user. */
export async function POST(request: NextRequest, { params }: { params: { pid: string } }) {
  const pid = params.pid;
  if (!UUID_RE.test(pid)) return new NextResponse("Not found", { status: 404 });
  const supabase = createClient();
  const auth = { user: await currentUser() };
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasServiceRole()) return back(request, pid, { error: "storage_unconfigured" });

  // the caller must be able to write to this patient (RLS exposes only their own membership rows)
  const { data: member } = await supabase.from("patient_members").select("can_write").eq("patient_id", pid).eq("user_id", auth.user.id).is("revoked_at", null).maybeSingle();
  if (!member?.can_write) return new NextResponse("Forbidden", { status: 403 });

  let form: FormData;
  try { form = await request.formData(); } catch { return back(request, pid, { error: "bad_form" }); }
  const to = String(form.get("_return") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back(request, pid, { error: "no_file" }, to);
  if (file.size > MAX_DOC_BYTES) return back(request, pid, { error: "too_large" }, to);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) return back(request, pid, { error: "bad_type" }, to);
  if (mime === "application/pdf" && pdfHasActiveContent(bytes)) return back(request, pid, { error: "active_content" }, to);

  const title = String(form.get("title") ?? "").trim().slice(0, 200) || safeFilename(file.name);
  const docType = String(form.get("doc_type") ?? "other");
  const sens = String(form.get("sensitivity") ?? "standard");
  if (!DOC_TYPE.some((d) => d.value === docType) || !SENSITIVITY.some((s) => s.value === sens)) return back(request, pid, { error: "bad_form" }, to);
  const opt = (k: string) => { const v = String(form.get(k) ?? ""); return UUID_RE.test(v) ? v : null; };
  const date = String(form.get("document_date") ?? "");

  // the very same file already in this patient's record: say so once, unless the user confirmed
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (form.get("allow_duplicate") !== "on") {
    const { data: same } = await supabase.from("medical_documents").select("id").eq("patient_id", pid).eq("sha256", sha256).eq("record_status", "active").limit(1);
    if (same?.length) return back(request, pid, { error: "duplicate", dup: String(same[0].id) }, to);
  }

  const path = `${pid}/${randomUUID()}.${EXT[mime]}`;
  const admin = createAdminClient();
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "0" });
  if (up.error) return back(request, pid, { error: "upload_failed" }, to);

  const { error } = await supabase.rpc("register_document", {
    p_patient: pid, p_title: title, p_doc_type: docType, p_storage_path: path, p_filename: safeFilename(file.name), p_mime: mime,
    p_size: file.size, p_sha256: sha256,
    p_specialty: opt("specialty_id"), p_description: String(form.get("description") ?? "").slice(0, 1000) || null,
    p_document_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, p_sensitivity: sens,
    p_encounter: opt("encounter_id"), p_lab_report: opt("lab_report_id"), p_imaging: opt("imaging_id"),
  });
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);          // no orphaned files
    return back(request, pid, { error: "register_failed" }, to);
  }
  return back(request, pid, { uploaded: "1" }, to);
}
