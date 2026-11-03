import { normText } from "@/lib/dedupe";
import type { ClinicalContextData } from "@/lib/clinical-context";

/*
 * Safety alerts as reviewable rules (public.safety_rules, migration 0027). A rule is data an administrator reviews; this
 * module only matches it against the record and the planned treatment and says *why* it matched. An alert is a reminder to
 * review, never a diagnosis and never a block.
 *
 * A rule's `match` has:
 *   - record factors, any one of which raises it: conditions / medications / allergies (keywords, compared without
 *     diacritics or letter-form differences), devices (device kinds), pregnancy, labs (a latest value against a threshold);
 *   - optional triggers: `procedures` (catalogue categories or codes) and `drugs` (keywords of drugs being prescribed).
 *     A rule with triggers is shown only next to the planned treatment (or drug) it concerns; a rule without them is a
 *     reminder about the patient.
 */

export type Severity = "info" | "warn" | "danger";
export interface LabCondition { code: string; gte?: number; gt?: number; lte?: number; lt?: number }
export interface RuleMatch {
  conditions?: string[]; medications?: string[]; allergies?: string[]; devices?: string[]; pregnancy?: boolean; labs?: LabCondition[];
  procedures?: { categories?: string[]; codes?: string[] }; drugs?: string[];
}
/** a row of public.safety_rules */
export interface SafetyRuleRow {
  id?: string; code: string; specialty_code: string; title_ar: string; title_en: string; message_ar: string; message_en: string; severity: Severity;
  match: RuleMatch; reference: string | null; sort?: number; is_active?: boolean; version?: number; reviewed_at?: string | null; reviewed_by?: string | null;
}

/** the part of the core context the rules read */
export type SafetyContext = Pick<ClinicalContextData, "conditions" | "medications" | "allergies" | "devices" | "lifestyle">;
/** a treatment still to happen (proposed, planned, accepted, scheduled…), with its catalogue category */
export interface PlannedItem { id: string; name: string; catalog_code: string | null; category?: string | null; teeth?: number[] | null; plan?: string }
export interface SafetyInput {
  context: SafetyContext;
  items?: PlannedItem[];
  /** names of drugs being prescribed */
  drugs?: string[];
  /** latest numeric result per observation type code (e.g. hba1c) */
  labs?: Record<string, number | null | undefined>;
  /** other recorded names that can matter (diagnoses of any category, past procedures such as radiotherapy) */
  history?: string[];
  /** the specialties being viewed; defaults to dentistry; "all" applies every rule */
  specialties?: string[] | "all";
}

export interface Reason { kind: "condition" | "medication" | "allergy" | "device" | "pregnancy" | "lab"; matched: string }
export interface SafetyAlert {
  code: string; severity: Severity; title_ar: string; title_en: string; message_ar: string; message_en: string; reference: string | null;
  /** which records of the file matched */
  reasons: Reason[];
  /** the planned treatments the rule concerns (empty for a reminder about the patient) */
  items: PlannedItem[];
  /** the drugs being prescribed that it concerns */
  drugs: string[];
  /** has an administrator reviewed this version of the rule? */
  reviewed: boolean;
}

const RANK: Record<Severity, number> = { danger: 0, warn: 1, info: 2 };

const hits = (names: string[], keywords: string[] | undefined): string[] => {
  if (!keywords?.length) return [];
  const keys = keywords.map(normText).filter(Boolean);
  return names.filter((n) => { const x = normText(n); return Boolean(x) && keys.some((k) => x.includes(k)); });
};
const labHit = (c: LabCondition, v: number | null | undefined): boolean => {
  if (v == null || !Number.isFinite(v)) return false;
  return (c.gte == null || v >= c.gte) && (c.gt == null || v > c.gt) && (c.lte == null || v <= c.lte) && (c.lt == null || v < c.lt);
};
/** does the rule have a trigger (so it is about a treatment or a drug, not only about the patient)? */
export const hasTrigger = (m: RuleMatch): boolean =>
  Boolean(m.procedures?.categories?.length || m.procedures?.codes?.length || m.drugs?.length);

/** The reasons from the record that raise the rule (none: the rule does not apply to this patient). */
export function recordReasons(m: RuleMatch, input: SafetyInput): Reason[] {
  const c = input.context;
  const out: Reason[] = [];
  const names = [...c.conditions.map((x) => x.name), ...(input.history ?? [])];
  for (const x of hits(names, m.conditions)) out.push({ kind: "condition", matched: x });
  for (const x of hits(c.medications.map((d) => d.name), m.medications)) out.push({ kind: "medication", matched: x });
  for (const x of hits(c.allergies.map((a) => a.substance), m.allergies)) out.push({ kind: "allergy", matched: x });
  if (m.devices?.length) for (const d of c.devices) if (m.devices.includes(d.kind)) out.push({ kind: "device", matched: d.name || d.kind });
  if (m.pregnancy && c.lifestyle?.pregnancy_status === "pregnant") out.push({ kind: "pregnancy", matched: "pregnancy" });
  for (const l of m.labs ?? []) {
    const v = input.labs?.[l.code];
    if (labHit(l, v)) out.push({ kind: "lab", matched: `${l.code} ${v}` });
  }
  return out;
}

/** The planned treatments a rule's procedure trigger concerns. */
export function triggeredItems(m: RuleMatch, items: PlannedItem[]): PlannedItem[] {
  const codes = m.procedures?.codes ?? [], cats = m.procedures?.categories ?? [];
  if (!codes.length && !cats.length) return [];
  return items.filter((i) => (i.catalog_code != null && codes.includes(i.catalog_code)) || (i.category != null && cats.includes(i.category)));
}

/**
 * The alerts that apply: rules for the viewed specialties whose record factor is present and, when the rule has a trigger,
 * whose trigger is present too (a planned treatment of that kind, or a drug being prescribed). Most serious first.
 */
export function evaluateSafety(rules: SafetyRuleRow[], input: SafetyInput): SafetyAlert[] {
  const spec = input.specialties ?? ["dentistry"];
  const out: SafetyAlert[] = [];
  for (const r of [...rules].filter((x) => x.is_active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    if (spec !== "all" && !spec.includes(r.specialty_code)) continue;
    const reasons = recordReasons(r.match, input);
    if (!reasons.length) continue;
    let items: PlannedItem[] = [], drugs: string[] = [];
    if (hasTrigger(r.match)) {
      items = triggeredItems(r.match, input.items ?? []);
      drugs = hits(input.drugs ?? [], r.match.drugs);
      if (!items.length && !drugs.length) continue;
    }
    out.push({
      code: r.code, severity: r.severity, title_ar: r.title_ar, title_en: r.title_en, message_ar: r.message_ar, message_en: r.message_en, reference: r.reference,
      reasons, items, drugs, reviewed: Boolean(r.reviewed_at),
    });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** The alerts that concern each planned treatment (to show them next to it). */
export function alertsByItem(alerts: SafetyAlert[]): Map<string, SafetyAlert[]> {
  const m = new Map<string, SafetyAlert[]>();
  for (const a of alerts) for (const i of a.items) m.set(i.id, [...(m.get(i.id) ?? []), a]);
  return m;
}

/** A short reading of one reason, for "because of…". */
export function reasonText(r: Reason, lang: "ar" | "en"): string {
  if (r.kind === "pregnancy") return lang === "ar" ? "الحمل" : "pregnancy";
  if (r.kind === "lab") return r.matched.replace(/^hba1c/i, "HbA1c");
  return r.matched;
}

/** Reads a stored rule defensively (it came from JSON): unknown shapes become empty lists instead of throwing. */
export function parseRuleRow(row: Record<string, unknown>): SafetyRuleRow {
  const m = (row.match && typeof row.match === "object" ? row.match : {}) as Record<string, unknown>;
  const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  const procs = m.procedures && typeof m.procedures === "object" ? (m.procedures as Record<string, unknown>) : null;
  const match: RuleMatch = {
    conditions: list(m.conditions), medications: list(m.medications), allergies: list(m.allergies), devices: list(m.devices),
    pregnancy: m.pregnancy === true ? true : undefined, drugs: list(m.drugs),
    labs: Array.isArray(m.labs) ? (m.labs as unknown[]).filter((x): x is LabCondition => Boolean(x) && typeof (x as LabCondition).code === "string") : undefined,
    procedures: procs ? { categories: list(procs.categories), codes: list(procs.codes) } : undefined,
  };
  const sev = row.severity === "info" || row.severity === "danger" ? row.severity : "warn";
  return {
    id: row.id as string | undefined, code: String(row.code ?? ""), specialty_code: String(row.specialty_code ?? "dentistry"),
    title_ar: String(row.title_ar ?? ""), title_en: String(row.title_en ?? ""), message_ar: String(row.message_ar ?? ""), message_en: String(row.message_en ?? ""),
    severity: sev, match, reference: (row.reference as string | null) ?? null, sort: Number(row.sort ?? 0), is_active: row.is_active !== false,
    version: Number(row.version ?? 1), reviewed_at: (row.reviewed_at as string | null) ?? null, reviewed_by: (row.reviewed_by as string | null) ?? null,
  };
}

/** Admin form text → a keyword list: one per line, or separated by commas. */
export function splitKeywords(v: string): string[] {
  return [...new Set(v.split(/[\n,،;]+/).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 80))];
}

/** The `match` of a rule from the administrator's form; the same shape the database checks (public.safety_match_ok). */
export function matchFromForm(fd: FormData): RuleMatch {
  const list = (k: string) => splitKeywords(String(fd.get(k) ?? ""));
  const m: RuleMatch = {};
  for (const k of ["conditions", "medications", "allergies", "drugs"] as const) { const v = list(k); if (v.length) m[k] = v; }
  const devices = fd.getAll("devices").map(String).filter((x) => /^[a-z_]{2,40}$/.test(x));
  if (devices.length) m.devices = devices;
  if (fd.get("pregnancy") === "on") m.pregnancy = true;
  const hb = String(fd.get("hba1c_gte") ?? "").trim();
  if (hb !== "" && Number.isFinite(Number(hb))) m.labs = [{ code: "hba1c", gte: Number(hb) }];
  const categories = fd.getAll("proc_categories").map(String).filter((x) => /^[a-z][a-z0-9_]{1,40}$/.test(x));
  const codes = String(fd.get("proc_codes") ?? "").split(/[\s,،;]+/).filter((x) => /^[a-z][a-z0-9_]{1,40}$/.test(x));
  if (categories.length || codes.length) m.procedures = { ...(categories.length ? { categories } : {}), ...(codes.length ? { codes: [...new Set(codes)] } : {}) };
  return m;
}
/** A rule needs something in the record to match (a trigger alone is not enough). */
export const hasRecordFactor = (m: RuleMatch): boolean =>
  Boolean(m.conditions?.length || m.medications?.length || m.allergies?.length || m.devices?.length || m.pregnancy || m.labs?.length);
