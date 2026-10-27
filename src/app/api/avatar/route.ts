import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { UUID_RE } from "@/lib/uuid";
import { sniffMime } from "@/lib/files";
import { AVATAR_BUCKET } from "@/lib/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const IMG_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const EXT_MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// Relative Location: behind a reverse proxy request.url carries the internal origin.
const back = (to: string, qs: Record<string, string> = {}) => {
  const q = new URLSearchParams(qs).toString();
  return new NextResponse(null, { status: 303, headers: { Location: q ? `${to}?${q}` : to } });
};
const safeReturn = (v: string, fallback: string) => (/^\/(account|patients\/[0-9a-f-]{36}\/profile)$/.test(v) ? v : fallback);

/** GET /api/avatar            -> the signed-in user's own picture
 *  GET /api/avatar?p=<pid>    -> a patient's photo, only for members of that file (RLS decides). */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });
  const pid = request.nextUrl.searchParams.get("p");
  let path: string | null = null;
  if (pid) {
    if (!UUID_RE.test(pid)) return new NextResponse("Not found", { status: 404 });
    const { data } = await supabase.from("patients").select("photo_path").eq("id", pid).maybeSingle();
    path = (data?.photo_path as string | null) ?? null;
    if (path && !path.startsWith(`p/${pid}/`)) path = null;     // never serve anything outside this patient's folder
  } else {
    const { data } = await supabase.from("profiles").select("avatar_path").eq("id", auth.user.id).maybeSingle();
    path = (data?.avatar_path as string | null) ?? null;
    if (path && !path.startsWith(`u/${auth.user.id}/`)) path = null;
  }
  const mime = path ? EXT_MIME[path.split(".").pop() ?? ""] : undefined;
  if (!path || !mime || !hasServiceRole()) return new NextResponse("Not found", { status: 404 });
  const { data: blob, error } = await createAdminClient().storage.from(AVATAR_BUCKET).download(path);
  if (error || !blob) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": mime, "Content-Length": String(blob.size),
      "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", "X-Robots-Tag": "noindex",
    },
  });
}

/** POST multipart: target=user | patient, pid (patient), file (optional when remove=1), returnTo. */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });
  let form: FormData;
  try { form = await request.formData(); } catch { return back("/account", { error: "bad_form" }); }
  const target = form.get("target") === "patient" ? "patient" : "user";
  const pid = String(form.get("pid") ?? "");
  const ret = safeReturn(String(form.get("returnTo") ?? ""), target === "patient" ? `/patients/${pid}/profile` : "/account");
  if (!hasServiceRole()) return back(ret, { error: "storage_unconfigured" });

  let folder: string, oldPath: string | null;
  if (target === "patient") {
    if (!UUID_RE.test(pid)) return new NextResponse("Not found", { status: 404 });
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase.from("patient_members").select("can_write").eq("patient_id", pid).eq("user_id", auth.user.id).is("revoked_at", null).maybeSingle(),
      supabase.from("patients").select("photo_path, deletion_requested_at").eq("id", pid).maybeSingle(),
    ]);
    if (!p) return new NextResponse("Not found", { status: 404 });
    if (!m?.can_write || p.deletion_requested_at) return new NextResponse("Forbidden", { status: 403 });
    folder = `p/${pid}`; oldPath = (p.photo_path as string | null) ?? null;
  } else {
    const { data: pr } = await supabase.from("profiles").select("avatar_path").eq("id", auth.user.id).maybeSingle();
    folder = `u/${auth.user.id}`; oldPath = (pr?.avatar_path as string | null) ?? null;
  }
  const admin = createAdminClient();
  const save = async (path: string | null) => {
    const { error } = target === "patient"
      ? await supabase.from("patients").update({ photo_path: path }).eq("id", pid)       // RLS: needs write access
      : await admin.from("profiles").update({ avatar_path: path }).eq("id", auth.user!.id);
    return !error;
  };

  if (form.get("remove") === "1") {
    if (!(await save(null))) return back(ret, { error: "save_failed" });
    if (oldPath) await admin.storage.from(AVATAR_BUCKET).remove([oldPath]);
    return back(ret, { photo: "removed" });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back(ret, { error: "no_file" });
  if (file.size > MAX_AVATAR_BYTES) return back(ret, { error: "too_large" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime || !IMG_EXT[mime]) return back(ret, { error: "bad_type" });     // PDFs and anything else are refused
  const path = `${folder}/${randomUUID()}.${IMG_EXT[mime]}`;
  const up = await admin.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return back(ret, { error: "upload_failed" });
  if (!(await save(path))) { await admin.storage.from(AVATAR_BUCKET).remove([path]); return back(ret, { error: "save_failed" }); }
  if (oldPath) await admin.storage.from(AVATAR_BUCKET).remove([oldPath]);
  return back(ret, { photo: "saved" });
}
