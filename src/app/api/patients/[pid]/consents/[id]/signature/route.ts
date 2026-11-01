import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { serveStoredFile } from "@/lib/storage";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";

/** The drawn signature of a consent, for the members of the patient's file only (RLS on consents). */
export async function GET(_: Request, { params }: { params: { pid: string; id: string } }) {
  if (!UUID_RE.test(params.pid) || !UUID_RE.test(params.id)) return new NextResponse("Not found", { status: 404 });
  if (!(await currentUser())) return new NextResponse("Unauthorized", { status: 401 });
  const { data } = await createClient().from("consents").select("signature_path").eq("id", params.id).eq("patient_id", params.pid).maybeSingle();
  if (!data) return new NextResponse("Not found", { status: 404 });
  return serveStoredFile(data.signature_path as string, "image/png", "consent-signature.png", false);
}
