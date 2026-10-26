import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth";
import type { ObservationType, PatientRow, Specialty } from "@/lib/types";

export { UUID_RE } from "@/lib/uuid";
import { UUID_RE } from "@/lib/uuid";

export const getSpecialties = cache(async (): Promise<Specialty[]> => {
  const { data } = await createClient().from("medical_specialties").select("*").eq("is_active", true).order("sort");
  return (data ?? []) as Specialty[];
});

export const getObsTypes = cache(async (): Promise<ObservationType[]> => {
  const { data } = await createClient().from("observation_types").select("*").eq("is_active", true).order("sort");
  return (data ?? []) as ObservationType[];
});

/** RLS decides whether this returns anything: another user's patient id simply 404s. */
export const getPatient = cache(async (pid: string): Promise<PatientRow> => {
  if (!UUID_RE.test(pid)) notFound();
  const { data } = await createClient().from("patients").select("*").eq("id", pid).maybeSingle();
  if (!data) notFound();
  return data as PatientRow;
});

export const getAccess = cache(async (pid: string) => {
  const user = await currentUser();
  const { data } = await createClient().from("patient_members").select("role, can_write, can_share").eq("patient_id", pid).eq("user_id", user?.id ?? "").is("revoked_at", null).maybeSingle();
  return {
    role: (data?.role as string | undefined) ?? "none",
    canWrite: Boolean(data?.can_write),
    canShare: Boolean(data?.can_share),
    canManage: data?.role === "owner" || data?.role === "guardian",
    userId: user?.id ?? "",
  };
});

export function specialtyName(list: Specialty[], id: string | null | undefined, lang: "ar" | "en"): string {
  if (!id) return "";
  const s = list.find((x) => x.id === id);
  return s ? (lang === "ar" ? s.name_ar : s.name_en) : "";
}
