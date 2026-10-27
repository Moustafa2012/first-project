import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { purgePatient } from "@/lib/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Retention job: permanently erases files whose 30-day deletion grace period has elapsed.
 * Call it daily from a scheduler: GET /api/cron/purge with `Authorization: Bearer $CRON_SECRET`.
 * Disabled (404) unless CRON_SECRET is set.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24 || !hasServiceRole()) return new NextResponse("Not found", { status: 404 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!same(given, secret)) return new NextResponse("Unauthorized", { status: 401 });
  const { data, error } = await createAdminClient().rpc("patient_purge_due");
  if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  const ids = (data as string[] | null) ?? [];
  let purged = 0, failed = 0;
  for (const id of ids) {
    try { await purgePatient(id, false); purged++; } catch { failed++; }
  }
  return NextResponse.json({ due: ids.length, purged, failed });
}
