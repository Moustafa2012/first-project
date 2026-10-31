import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getObsTypes, getPatient } from "@/lib/data";
import type { BodyValue, ClinicalContextData, HighlightRule, Lifestyle } from "@/lib/clinical-context";

/** The patient's core context, read with the signed-in account's rights (RLS applies). */
export const getClinicalContext = cache(async (pid: string): Promise<ClinicalContextData> => {
  const supabase = createClient();
  const [p, types] = await Promise.all([getPatient(pid), getObsTypes()]);
  const ids = types.filter((t) => t.code === "height" || t.code === "weight").map((t) => t.id);
  const codeOf = new Map(types.map((t) => [t.id, t.code]));
  const [{ data: obs }, { data: allergies }, { data: conditions }, { data: meds }, { data: devices }, { data: life }, { data: rules }] = await Promise.all([
    supabase.from("observations").select("type_id, value_num, unit, effective_at").eq("patient_id", pid).in("type_id", ids)
      .in("status", ["final", "preliminary", "amended"]).order("effective_at", { ascending: false }).limit(40),
    supabase.from("allergies").select("substance, category, reaction, severity, certainty").eq("patient_id", pid).eq("status", "active")
      .eq("record_status", "active").neq("certainty", "refuted").order("substance"),
    supabase.from("conditions").select("name, category, clinical_status, certainty").eq("patient_id", pid).eq("record_status", "active")
      .neq("certainty", "refuted").in("category", ["chronic", "congenital", "genetic", "disability"])
      .in("clinical_status", ["active", "recurrence", "inactive", "remission"]).order("name"),
    supabase.from("medications").select("name_generic, name_brand, strength, dose, frequency, long_term, status").eq("patient_id", pid)
      .eq("record_status", "active").in("status", ["active", "on_hold"]),
    supabase.from("patient_devices").select("kind, name, body_site, implanted_on, date_precision, mri_safety").eq("patient_id", pid)
      .eq("record_status", "active").eq("status", "in_place").order("implanted_on", { ascending: false }),
    supabase.from("patient_health_profile").select("*").eq("patient_id", pid).maybeSingle(),
    supabase.from("context_highlights").select("specialty_code, source, keywords, device_kinds, level, message_ar, message_en, sort, reviewed_by_clinician").eq("is_active", true),
  ]);
  const body: { height?: BodyValue; weight?: BodyValue } = {};
  for (const o of obs ?? []) {
    const code = codeOf.get(o.type_id as string) as "height" | "weight" | undefined;
    if (code && !body[code] && o.value_num != null) body[code] = { value: Number(o.value_num), unit: o.unit as string | null, at: o.effective_at as string };
  }
  return {
    patient: { date_of_birth: p.date_of_birth, sex: p.sex, blood_abo: p.blood_abo, blood_rh: p.blood_rh, blood_group_verified: p.blood_group_verified, allergy_assertion: p.allergy_assertion },
    body,
    allergies: (allergies ?? []) as ClinicalContextData["allergies"],
    conditions: (conditions ?? []) as ClinicalContextData["conditions"],
    medications: (meds ?? []).map((m) => ({ name: (m.name_generic ?? m.name_brand ?? "") as string, strength: m.strength, dose: m.dose, frequency: m.frequency, long_term: Boolean(m.long_term), status: m.status as string }))
      .sort((a, b) => Number(b.long_term) - Number(a.long_term) || a.name.localeCompare(b.name)),
    devices: (devices ?? []) as ClinicalContextData["devices"],
    lifestyle: (life ?? null) as Lifestyle | null,
    highlights: (rules ?? []) as HighlightRule[],
  };
});
