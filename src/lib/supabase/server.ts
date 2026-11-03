import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Per-request client that acts as the signed-in user, so Row Level Security applies. */
export function createClient() {
  const store = cookies();
  const { url, key } = publicEnv();
  // The auth server records the User-Agent of the request that opens a session. Without this it would record the web
  // server's own, and the account's session list could not tell the user's devices apart.
  const ua = headers().get("user-agent");
  return createServerClient(url, key, {
    global: ua ? { headers: { "User-Agent": ua.slice(0, 400) } } : undefined,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component: the middleware refreshes the session instead
        }
      },
    },
  });
}
