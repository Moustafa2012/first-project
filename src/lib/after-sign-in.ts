import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Bookkeeping after any successful sign-in: a pending account deletion is cancelled (signing in again inside the grace
 * period is the cancellation) and the sign-in is written to the account's activity log. Neither may block signing in.
 * "purged" = the files of the account were already erased, so the request can no longer be undone.
 */
export async function afterSignIn(supabase: SupabaseClient): Promise<"restored" | "purged" | null> {
  const ua = headers().get("user-agent") ?? "";
  const { data, error } = await supabase.rpc("account_cancel_deletion");
  if (error && /purge_started/.test(error.message)) {
    await supabase.auth.signOut();
    return "purged";
  }
  await supabase.rpc("account_record_event", { p_kind: "sign_in", p_user_agent: ua.slice(0, 300) });
  return data === true ? "restored" : null;
}
