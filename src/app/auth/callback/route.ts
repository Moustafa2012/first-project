import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Relative Location: behind a reverse proxy the request origin is the internal one.
const go = (to: string) => new NextResponse(null, { status: 303, headers: { Location: to } });

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/patients";
  const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/patients";
  if (code) {
    const { error } = await createClient().auth.exchangeCodeForSession(code);
    if (!error) return go(dest);
  }
  return go("/login?error=callback");
}
