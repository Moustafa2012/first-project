import { ALLERGY_STATUS, CERTAINTY, CLINICAL_STATUS, MED_STATUS, type Opt } from "@/lib/labels";

/** The life cycle of a record kind: which column holds the status and where each status can go next. */
export interface StatusModel { field: string; options: Opt[]; next: Record<string, string[]> }

/** "ruled out" is a certainty change, offered with the statuses of a diagnosis */
export const RULED_OUT: Opt = { value: "refuted", ar: "مُستبعد (ليس هذا التشخيص)", en: "Ruled out (not this diagnosis)" };

export const STATUS_MODEL: Record<string, StatusModel> = {
  conditions: {
    field: "clinical_status", options: CLINICAL_STATUS,
    next: {
      active: ["resolved", "inactive", "remission", "refuted"], recurrence: ["resolved", "inactive", "remission"],
      inactive: ["active", "recurrence", "resolved", "refuted"], remission: ["recurrence", "active", "resolved"], resolved: ["recurrence"],
    },
  },
  medications: {
    field: "status", options: MED_STATUS,
    next: { active: ["on_hold", "stopped", "completed"], on_hold: ["active", "stopped"], stopped: ["active"], completed: ["active"] },
  },
  allergies: {
    field: "status", options: ALLERGY_STATUS,
    next: { active: ["inactive", "resolved"], inactive: ["active", "resolved"], resolved: ["active"] },
  },
};

/** The statuses a record can move to now (a ruled-out diagnosis stays as it is; a clinician's addition cannot be ruled out by the account). */
export function nextStatuses(table: string, current: string, opts: { certainty?: string; contributed?: boolean } = {}): Opt[] {
  const m = STATUS_MODEL[table];
  if (!m || opts.certainty === "refuted") return [];
  return (m.next[current] ?? [])
    .filter((v) => !(v === "refuted" && opts.contributed))
    .map((v) => (v === "refuted" ? RULED_OUT : m.options.find((o) => o.value === v)!))
    .filter(Boolean);
}

export function statusLabel(field: string, value: string | null, lang: "ar" | "en", table: string): string {
  if (value == null) return "";
  const list = field === "certainty" ? CERTAINTY : STATUS_MODEL[table]?.options ?? [];
  return list.find((o) => o.value === value)?.[lang] ?? value;
}
