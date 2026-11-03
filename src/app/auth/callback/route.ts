import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLocalPath } from "@/lib/safe-path";
import { afterSignIn } from "@/lib/after-sign-in";

// Relative Location: behind a reverse proxy the request origin is the internal one.
const go = (to: string) => new NextResponse(null, { status: 303, headers: { Location: to } });

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/patients";
  const dest = isLocalPath(next) ? next : "/patients";
  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const after = await afterSignIn(supabase);
      if (after === "purged") return go("/login?error=deleted");
      return go(after === "restored" ? "/account?restored=1" : dest);
    }
  }
  return go("/login?error=callback");
}
