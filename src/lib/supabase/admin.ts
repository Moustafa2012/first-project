import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS: use ONLY for (a) the private document bucket after the caller's access was
 * verified, and (b) the share viewer functions that are executable by service_role only.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createSupabaseClient(publicEnv().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next's fetch cache would otherwise serve a repeated POST (e.g. the retention job's "what is due" lookup) from an earlier answer
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}

export function hasServiceRole(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
