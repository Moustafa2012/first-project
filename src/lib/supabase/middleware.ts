import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isConfigured, publicEnv } from "@/lib/env";

const PUBLIC_PREFIXES = ["/login", "/signup", "/forgot", "/auth", "/s/", "/e/", "/api/health", "/api/cron/"];

/** Refreshes the auth cookies and redirects anonymous visitors away from private pages. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
  if (!isConfigured()) return response;

  const { url, key } = publicEnv();
  const ua = request.headers.get("user-agent");
  const supabase = createServerClient(url, key, {
    global: ua ? { headers: { "User-Agent": ua.slice(0, 400) } } : undefined,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // verifies the token locally (and refreshes it when it expired) instead of asking the auth server on every request
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }
  return response;
}
