import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Per-request client that acts as the signed-in user, so Row Level Security applies. */
export function createClient() {
  const store = cookies();
  const { url, key } = publicEnv();
  return createServerClient(url, key, {
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
