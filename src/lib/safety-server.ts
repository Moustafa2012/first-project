import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getObsTypes } from "@/lib/data";
import { parseRuleRow, type SafetyRuleRow } from "@/lib/safety-rules";
import type { Bundle } from "@/lib/share-types";

const COLS = "id, code, specialty_code, title_ar, title_en, message_ar, message_en, severity, match, reference, sort, is_active, version, reviewed_by, reviewed_at";

/** The active safety rules (reference data, readable by every signed-in account). */
export const getSafetyRules = cache(async (): Promise<SafetyRuleRow[]> => {
  const { data } = await createClient().from("safety_rules").select(COLS).eq("is_active", true).order("sort");
  return (data ?? []).map((r) => parseRuleRow(r as Record<string, unknown>));
});

/** The same rules for the shared view (the service role reads them; they hold no patient data). */
export async function getSafetyRulesForShare(): Promise<SafetyRuleRow[]> {
  const { data } = await createAdminClient().from("safety_rules").select(COLS).eq("is_active", true).order("sort");
  return (data ?? []).map((r) => parseRuleRow(r as Record<string, unknown>));
}

/** What the rules read beyond the core context: the latest HbA1c, and other recorded diagnoses and past procedures by name. */
export const getSafetyFacts = cache(async (pid: string): Promise<{ labs: Record<string, number | null>; history: string[] }> => {
  const supabase = createClient();
  const types = await getObsTypes();
  const hba1c = types.find((t) => t.code === "hba1c")?.id;
  const [obs, conds, procs] = await Promise.all([
    hba1c
      ? supabase.from("observations").select("value_num, effective_at").eq("patient_id", pid).eq("type_id", hba1c).in("status", ["final", "preliminary", "amended"])
          .order("effective_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as { value_num: number | null }[] }),
    supabase.from("conditions").select("name").eq("patient_id", pid).eq("record_status", "active").neq("certainty", "refuted").limit(300),
    supabase.from("procedures").select("name").eq("patient_id", pid).eq("record_status", "active").limit(300),
  ]);
  const v = (obs.data ?? [])[0]?.value_num;
  return {
    labs: { hba1c: v == null ? null : Number(v) },
    history: [...(conds.data ?? []), ...(procs.data ?? [])].map((r) => String((r as { name: string }).name)),
  };
});

/** The same facts from what a share bundle carries (only what the patient allowed the doctor to see). */
export function shareSafetyFacts(b: Bundle): { labs: Record<string, number | null>; history: string[] } {
  const names = (list: Record<string, unknown>[] | undefined) => (list ?? []).map((x) => String(x.name ?? "")).filter(Boolean);
  const h = (b.observations ?? []).filter((o) => o.type_code === "hba1c" && o.value_num != null)
    .sort((x, y) => String(y.effective_at).localeCompare(String(x.effective_at)))[0];
  return {
    labs: { hba1c: h ? Number(h.value_num) : null },
    history: [...names(b.chronic_conditions), ...names(b.other_conditions), ...names(b.procedures)],
  };
}
