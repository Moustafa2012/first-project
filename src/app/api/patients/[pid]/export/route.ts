import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/data";

const cell = (v: unknown): string => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;           // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of a patient's measurements. Runs as the signed-in user, so RLS decides what is visible. */
export async function GET(request: NextRequest, { params }: { params: { pid: string } }) {
  if (!UUID_RE.test(params.pid)) return new NextResponse("Not found", { status: 404 });
  const supabase = createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });
  const code = request.nextUrl.searchParams.get("type");
  let q = supabase.from("observations")
    .select("effective_at, unit, value_num, value_num2, value_text, context, setting, device, interpretation, status, ref_low, ref_high, ref_text, notes, source, verification, observation_types!inner(code, name_en)")
    .eq("patient_id", params.pid).order("effective_at");
  if (code && /^[a-z0-9_]+$/.test(code)) q = q.eq("observation_types.code", code);
  const { data, error } = await q.limit(20000);
  if (error) return new NextResponse("Error", { status: 500 });
  const head = ["measured_at", "test", "value", "value2", "text_value", "unit", "context", "setting", "device", "flag", "status", "ref_low", "ref_high", "ref_text", "source", "verification", "notes"];
  const lines = [head.join(",")];
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const ty = r.observation_types as { name_en: string } | null;
    lines.push([r.effective_at, ty?.name_en, r.value_num, r.value_num2, r.value_text, r.unit, r.context, r.setting, r.device, r.interpretation, r.status, r.ref_low, r.ref_high, r.ref_text, r.source, r.verification, r.notes].map(cell).join(","));
  }
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="measurements-${code ?? "all"}.csv"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    },
  });
}
