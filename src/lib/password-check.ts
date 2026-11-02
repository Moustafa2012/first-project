import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Re-checks the password of the signed-in user without touching their session: a throw-away client that is signed out
 * again at once, so the check leaves no extra row in the account's session list.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  const { url, key } = publicEnv();
  const c = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await c.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}
