import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ContribItem { table: string; id: string; label: string | null; at: string | null; record_status: string; by: string; mine: boolean }
export interface ContribState {
  status: string;
  patient_id?: string;               // server-side only (storage paths); never rendered
  modules?: string[];
  max?: number;
  used?: number;
  contributor?: { id: string; full_name: string; specialty: string | null; license_no: string | null; facility: string | null } | null;
  items?: ContribItem[];
  encounters?: { id: string; started_at: string; reason: string | null; kind: string }[];
}

/** What the clinician in this share session may add, who they said they are, and what was added through the share. */
export async function contribState(session: string): Promise<ContribState> {
  const { data, error } = await createAdminClient().rpc("share_contrib_state", { p_session_token: session });
  if (error || !data) return { status: "error" };
  return data as ContribState;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Decodes an on-screen signature (PNG data URL); null when it is not a real, reasonably sized PNG. */
export function signaturePng(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length < 200 || bytes.length > 400_000) return null;
  return PNG.every((b, i) => bytes[i] === b) ? bytes : null;
}
