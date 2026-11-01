import { normText } from "@/lib/dedupe";
import type { Series } from "@/lib/clinical/series";

/** Symptom log helpers: entries of the same symptom (names compared without case, diacritics or letter forms) form one series. */
export interface SymptomPoint { id: string; symptom: string; severity: number | null; onset_at: string; ended_at: string | null }
export interface SymptomGroup { key: string; label: string; raw: string[]; n: number; lastAt: string; ongoing: boolean }

export const SEVERITY_SCALE: [number, number] = [0, 10];

/** Groups entries by symptom name, the most recently active first; the label is the latest spelling used. */
export function groupSymptoms(rows: SymptomPoint[]): SymptomGroup[] {
  const map = new Map<string, SymptomGroup & { latest: number }>();
  for (const r of rows) {
    const key = normText(r.symptom);
    if (!key) continue;
    const t = Date.parse(r.onset_at);
    const g = map.get(key) ?? { key, label: r.symptom.trim(), raw: [], n: 0, lastAt: r.onset_at, ongoing: false, latest: -Infinity };
    if (!g.raw.includes(r.symptom)) g.raw.push(r.symptom);
    g.n++;
    if (r.ended_at == null) g.ongoing = true;
    if (t >= g.latest) { g.latest = t; g.lastAt = r.onset_at; g.label = r.symptom.trim(); }
    map.set(key, g);
  }
  return Array.from(map.values()).sort((a, b) => b.latest - a.latest).map(({ latest: _l, ...g }) => g);
}

/** One chart series (severity 0-10 over time) for a symptom; entries without a severity are not plotted. */
export function symptomSeries(rows: SymptomPoint[], group: SymptomGroup): Series[] {
  const pts = rows
    .filter((r) => normText(r.symptom) === group.key && r.severity != null)
    .map((r) => ({ t: Date.parse(r.onset_at), v: Number(r.severity), id: r.id, interp: "not_assessed", context: null, refLow: null, refHigh: null, lab: null, unit: "/10" }))
    .filter((p) => Number.isFinite(p.t) && p.v >= 0 && p.v <= 10)
    .sort((a, b) => a.t - b.t);
  return [{ key: `symptom:${group.key}`, label: { ar: group.label, en: group.label }, unit: "/10", role: "main", pts }];
}

/** Suggestions offered while typing a symptom name (free text is always allowed). */
export const COMMON_SYMPTOMS: [string, string][] = [
  ["صداع", "Headache"], ["دوخة", "Dizziness"], ["غثيان", "Nausea"], ["قيء", "Vomiting"], ["إسهال", "Diarrhoea"], ["إمساك", "Constipation"],
  ["ألم في البطن", "Abdominal pain"], ["ألم في الصدر", "Chest pain"], ["ضيق في التنفس", "Shortness of breath"], ["سعال", "Cough"], ["حمى", "Fever"],
  ["تعب وإرهاق", "Fatigue"], ["ألم في الظهر", "Back pain"], ["ألم في المفاصل", "Joint pain"], ["خفقان", "Palpitations"], ["أرق", "Insomnia"],
  ["طفح جلدي", "Rash"], ["حكة", "Itching"], ["ألم في الأسنان", "Toothache"], ["ألم في الحلق", "Sore throat"], ["احتقان الأنف", "Nasal congestion"],
  ["تورم", "Swelling"], ["نزيف", "Bleeding"], ["فقدان الشهية", "Loss of appetite"], ["عطش شديد", "Excessive thirst"],
];
