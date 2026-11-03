import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/auth";
import type { ObservationType, PatientRow, Specialty } from "@/lib/types";
import type { CatalogItem } from "@/lib/treatment";

export { UUID_RE } from "@/lib/uuid";
import { UUID_RE } from "@/lib/uuid";

// Catalogues (specialties, measurement types) change rarely: keep them in memory for 10 minutes instead of two
// database round trips per page. Read with the service role when available (the data is public reference data, no
// patient information); admin edits clear the cache.
const CATALOG_TTL_MS = 10 * 60_000;
const catalogs = new Map<string, { at: number; data: unknown[] }>();
export function clearCatalogCache() { catalogs.clear(); }

async function catalog<T>(table: "medical_specialties" | "observation_types" | "procedure_catalog"): Promise<T[]> {
  const hit = catalogs.get(table);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.data as T[];
  const client = hasServiceRole() ? createAdminClient() : createClient();
  const { data } = await client.from(table).select("*").eq("is_active", true).order("sort");
  const rows = (data ?? []) as T[];
  if (rows.length) catalogs.set(table, { at: Date.now(), data: rows });
  return rows;
}

export const getSpecialties = cache(async (): Promise<Specialty[]> => catalog<Specialty>("medical_specialties"));
export const getObsTypes = cache(async (): Promise<ObservationType[]> => catalog<ObservationType>("observation_types"));
/** The local catalogue of dental procedures (reference data, cached like the other catalogues). */
export const getProcedureCatalog = cache(async (): Promise<CatalogItem[]> => catalog<CatalogItem>("procedure_catalog"));

/** RLS decides whether this returns anything: another user's patient id simply 404s. */
export const getPatient = cache(async (pid: string): Promise<PatientRow> => {
  if (!UUID_RE.test(pid)) notFound();
  const { data } = await createClient().from("patients").select("*").eq("id", pid).maybeSingle();
  if (!data) notFound();
  return data as PatientRow;
});

export const getAccess = cache(async (pid: string) => {
  const user = await currentUser();
  const [{ data }, patient] = await Promise.all([
    createClient().from("patient_members").select("role, can_write, can_share").eq("patient_id", pid).eq("user_id", user?.id ?? "").is("revoked_at", null).maybeSingle(),
    getPatient(pid),                                   // already fetched by the layout in this request (cached)
  ]);
  const frozen = Boolean(patient.deletion_requested_at);   // a file pending deletion is read-only
  return {
    role: (data?.role as string | undefined) ?? "none",
    canWrite: Boolean(data?.can_write) && !frozen,
    canShare: Boolean(data?.can_share) && !frozen,
    pendingDeletion: frozen,
    canManage: data?.role === "owner" || data?.role === "guardian",
    userId: user?.id ?? "",
  };
});

export function specialtyName(list: Specialty[], id: string | null | undefined, lang: "ar" | "en"): string {
  if (!id) return "";
  const s = list.find((x) => x.id === id);
  return s ? (lang === "ar" ? s.name_ar : s.name_en) : "";
}

export interface SpecialtyUse { specialty_id: string; code: string; name_ar: string; name_en: string; icon: string; n: number }
/** The specialties this file uses, the most used first (counted under RLS). Empty when nothing is recorded yet. */
export const getSpecialtyUsage = cache(async (pid: string): Promise<SpecialtyUse[]> => {
  const { data, error } = await createClient().rpc("patient_specialty_usage", { p_patient: pid });
  if (error || !Array.isArray(data)) return [];
  return (data as SpecialtyUse[]).map((r) => ({ ...r, n: Number(r.n) }));
});
