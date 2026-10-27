import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { serveStoredFile } from "@/lib/storage";
import { UUID_RE } from "@/lib/data";

export const runtime = "nodejs";

/** Signed-in access to a stored document. RLS decides whether the row is visible at all. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return new NextResponse("Not found", { status: 404 });
  const supabase = createClient();
  const auth = { user: await currentUser() };
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: doc } = await supabase.from("medical_documents").select("storage_path, mime_type, original_filename, record_status").eq("id", params.id).maybeSingle();
  if (!doc) return new NextResponse("Not found", { status: 404 });
  return serveStoredFile(doc.storage_path, doc.mime_type, doc.original_filename, request.nextUrl.searchParams.get("dl") === "1");
}
