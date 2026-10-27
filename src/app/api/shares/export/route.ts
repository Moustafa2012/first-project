import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SHARE_COLUMNS, shareStatus, type ShareListRow } from "@/lib/shares";

const cell = (v: unknown): string => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;           // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of the share register (no tokens, no PINs: they are not stored). Runs as the user, so RLS decides the rows. */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const wanted = request.nextUrl.searchParams.get("status");
  const [{ data }, { data: pats }] = await Promise.all([
    supabase.from("medical_shares").select(SHARE_COLUMNS).order("created_at", { ascending: false }).limit(5000),
    supabase.from("patients").select("id, mrn"),
  ]);
  const mrn = new Map((pats ?? []).map((p) => [p.id as string, p.mrn as string]));
  const head = ["share_id", "file_mrn", "purpose", "recipient", "scope", "token_ending", "status", "created_at", "expires_at", "revoked_at", "revoke_reason", "opens", "last_opened_at", "wrong_pin_attempts", "lock_count", "allow_download", "allow_print", "allow_notes", "include_sensitive"];
  const lines = [head.join(",")];
  for (const s of (data ?? []) as unknown as ShareListRow[]) {
    const st = shareStatus(s);
    if (wanted && wanted !== "all" && wanted !== st) continue;
    lines.push([s.id, mrn.get(s.patient_id), s.title, s.recipient_label, s.scope_kind, s.token_hint, st, s.created_at, s.expires_at, s.revoked_at, s.revoke_reason, s.access_count, s.last_accessed_at, s.failed_attempts, s.lock_count, s.allow_download, s.allow_print, s.allow_notes, s.include_sensitive].map(cell).join(","));
  }
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="share-register.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
