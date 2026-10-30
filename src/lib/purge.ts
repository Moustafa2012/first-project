import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";

export const AVATAR_BUCKET = "avatars";

/**
 * Permanently erases a file that is pending deletion: stored documents and the photo first, then the database rows
 * (public.patient_purge removes every clinical row, share, membership and audit copy, and keeps only a tombstone).
 * The caller has already authorised this (owner re-authenticated, or the retention period elapsed).
 */
export async function purgePatient(patientId: string, force: boolean): Promise<void> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("patients").select("id, photo_path, deletion_requested_at").eq("id", patientId).maybeSingle();
  if (!p || !p.deletion_requested_at) throw new Error("not_pending");
  const { data: docs } = await admin.from("medical_documents").select("storage_path").eq("patient_id", patientId);
  const paths = (docs ?? []).map((d) => d.storage_path as string);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error("storage_cleanup_failed");
  }
  // clinicians' on-screen signatures (share links that allowed additions)
  const { data: sigs } = await admin.storage.from(BUCKET).list(`${patientId}/signatures`, { limit: 1000 });
  const sigPaths = (Array.isArray(sigs) ? sigs : []).map((f) => `${patientId}/signatures/${f.name}`);
  if (sigPaths.length) { const { error } = await admin.storage.from(BUCKET).remove(sigPaths); if (error) throw new Error("storage_cleanup_failed"); }
  if (p.photo_path) await admin.storage.from(AVATAR_BUCKET).remove([p.photo_path as string]);
  const { error } = await admin.rpc("patient_purge", { p_patient: patientId, p_force: force });
  if (error) throw error;
}
