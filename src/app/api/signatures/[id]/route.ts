import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { serveStoredFile } from "@/lib/storage";
import { UUID_RE } from "@/lib/data";

export const runtime = "nodejs";

/** A clinician's on-screen signature, for the members of the patient's file only (RLS on share_contributors). */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return new NextResponse("Not found", { status: 404 });
  if (!(await currentUser())) return new NextResponse("Unauthorized", { status: 401 });
  const { data } = await createClient().from("share_contributors").select("signature_path").eq("id", params.id).maybeSingle();
  if (!data) return new NextResponse("Not found", { status: 404 });
  return serveStoredFile(data.signature_path as string, "image/png", "signature.png", false);
}
