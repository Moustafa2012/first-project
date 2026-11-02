/**
 * The emergency card: the fields the public link may show, and nothing else. The database builds the answer
 * (public.emergency_view); this module types it, checks its shape before anything is drawn from it, and builds the link.
 */
import { UUID_RE } from "@/lib/uuid";

export interface EmergencyCard {
  patient: { full_name: string; full_name_en: string | null; sex: string; date_of_birth: string; blood_abo: string | null; blood_rh: string | null; blood_group_verified: boolean; allergy_assertion: string };
  allergies: { substance: string; category: string | null; reaction: string | null; severity: string | null }[];
  conditions: { name: string; severity: string | null }[];
  medications: { name: string | null; strength: string | null; dose: string | null; frequency: string | null }[];
  devices: { kind: string; name: string | null; body_site: string | null; mri_safety: string | null }[];
  assertions: { none_chronic_conditions: boolean; none_long_term_medications: boolean; none_devices: boolean };
  contacts: { full_name: string; relation: string | null; phone: string; is_legal_representative: boolean }[];
  include_sensitive: boolean;
}

/** Tokens are made by the database: 24 random bytes in url-safe base64 (32 characters). */
export const validEmergencyToken = (t: string) => /^[A-Za-z0-9_-]{20,128}$/.test(t);
export const emergencyPath = (token: string) => `/e/${token}`;
export const emergencyLink = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}${emergencyPath(token)}`;

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
/** The answer of emergency_view, accepted only when it has the shape of a card (an unexpected answer is shown as unavailable). */
export function asCard(v: unknown): EmergencyCard | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const p = c.patient as Record<string, unknown> | undefined;
  if (!p || typeof p.full_name !== "string" || typeof p.date_of_birth !== "string") return null;
  if (!isArr(c.allergies) || !isArr(c.conditions) || !isArr(c.medications) || !isArr(c.devices) || !isArr(c.contacts)) return null;
  const a = (c.assertions ?? {}) as Record<string, unknown>;
  return {
    patient: p as unknown as EmergencyCard["patient"], allergies: c.allergies as EmergencyCard["allergies"], conditions: c.conditions as EmergencyCard["conditions"],
    medications: c.medications as EmergencyCard["medications"], devices: c.devices as EmergencyCard["devices"], contacts: c.contacts as EmergencyCard["contacts"],
    assertions: { none_chronic_conditions: a.none_chronic_conditions === true, none_long_term_medications: a.none_long_term_medications === true, none_devices: a.none_devices === true },
    include_sensitive: c.include_sensitive === true,
  };
}

export const bloodLabel = (p: Pick<EmergencyCard["patient"], "blood_abo" | "blood_rh">) => (p.blood_abo ? `${p.blood_abo}${p.blood_rh ?? ""}` : "");
/** "Metformin 500 mg · 1 tablet · twice a day" */
export const medLine = (m: EmergencyCard["medications"][number]) => [m.name, m.strength, m.dose, m.frequency].filter(Boolean).join(" · ");

/** The owner's page works on the token only while it is in hand: this reads a token passed back to the PDF route. */
export function tokenFromForm(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return validEmergencyToken(s) ? s : null;
}
export const isPatientId = (v: string) => UUID_RE.test(v);
