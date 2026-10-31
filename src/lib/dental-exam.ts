import type { Lang } from "@/lib/i18n";
import { isFdi } from "@/lib/dental";

/**
 * The parts of a comprehensive dental exam beyond the teeth: extraoral and jaw joint, soft tissues (oral cancer screening),
 * occlusion, hygiene and saliva; and pulp tests per tooth. Stored as `dental_exams.sections` (jsonb) and in
 * `dental_pulp_tests`. The database checks the same keys and values (app.dental_sections_ok, migration 0024).
 */

type L = [string, string];
export type FieldSpec =
  | { kind: "enum"; label: L; options: [string, L][] }
  | { kind: "int"; label: L; min: number; max: number; unit: L }
  | { kind: "text"; label: L; max: number };
export interface SectionSpec { key: SectionKey; title: L; hint?: L; fields: [string, FieldSpec][] }
export type SectionKey = "extraoral" | "soft_tissue" | "occlusion" | "hygiene";
export type Sections = Partial<Record<SectionKey, Record<string, string | number>>>;

const NA: [string, L] = ["normal", ["طبيعي", "Normal"]];
const AB: [string, L] = ["abnormal", ["غير طبيعي", "Abnormal"]];
const site = (ar: string, en: string): FieldSpec => ({ kind: "enum", label: [ar, en], options: [NA, AB] });
const note: FieldSpec = { kind: "text", label: ["ملاحظة", "Note"], max: 1000 };
const mm: L = ["مم", "mm"];

export const EXAM_SECTIONS: SectionSpec[] = [
  { key: "extraoral", title: ["خارج الفم والمفصل الفكي", "Extraoral & jaw joint"], fields: [
    ["face", { kind: "enum", label: ["الوجه", "Face"], options: [NA, ["swelling", ["تورّم", "Swelling"]], ["asymmetry", ["عدم تناظر", "Asymmetry"]]] }],
    ["lymph_nodes", { kind: "enum", label: ["العقد اللمفاوية", "Lymph nodes"], options: [NA, ["palpable", ["محسوسة", "Palpable"]], ["tender", ["مؤلمة", "Tender"]]] }],
    ["tmj_pain", { kind: "enum", label: ["ألم المفصل الفكي", "TMJ pain"], options: [["none", ["لا يوجد", "None"]], ["right", ["أيمن", "Right"]], ["left", ["أيسر", "Left"]], ["both", ["الجانبان", "Both"]]] }],
    ["tmj_sounds", { kind: "enum", label: ["أصوات المفصل", "TMJ sounds"], options: [["none", ["لا يوجد", "None"]], ["click", ["طقطقة", "Click"]], ["crepitus", ["خشخشة", "Crepitus"]]] }],
    ["mouth_opening_mm", { kind: "int", label: ["أقصى فتح للفم", "Maximum mouth opening"], min: 5, max: 80, unit: mm }],
    ["deviation", { kind: "enum", label: ["انحراف الفك عند الفتح", "Deviation on opening"], options: [["none", ["لا يوجد", "None"]], ["right", ["لليمين", "To the right"]], ["left", ["لليسار", "To the left"]]] }],
    ["muscles", { kind: "enum", label: ["عضلات المضغ", "Muscles of mastication"], options: [NA, ["tender", ["مؤلمة عند الجس", "Tender on palpation"]]] }],
    ["note", note],
  ] },
  { key: "soft_tissue", title: ["الأنسجة الرخوة داخل الفم", "Intraoral soft tissues"],
    hint: ["يشمل فحص سرطان الفم: أي قرحة أو بقعة بيضاء أو حمراء أو كتلة لا تلتئم خلال أسبوعين تُعدّ مشتبهة.", "Includes oral cancer screening: any ulcer, white or red patch or lump not healing within two weeks is suspicious."],
    fields: [
      ["lips", site("الشفاه", "Lips")], ["buccal_mucosa", site("باطن الخد", "Buccal mucosa")], ["tongue", site("اللسان", "Tongue")],
      ["floor_of_mouth", site("قاع الفم", "Floor of mouth")], ["hard_palate", site("الحنك الصلب", "Hard palate")],
      ["soft_palate", site("الحنك الرخو والبلعوم", "Soft palate & oropharynx")], ["gingiva", site("اللثة (المظهر)", "Gingiva (appearance)")],
      ["cancer_screening", { kind: "enum", label: ["فحص سرطان الفم", "Oral cancer screening"], options: [["no_suspicious", ["لا آفة مشتبهة", "No suspicious lesion"]], ["suspicious", ["آفة مشتبهة — تحتاج متابعة", "Suspicious lesion — needs follow-up"]]] }],
      ["note", { kind: "text", label: ["وصف ما ليس طبيعياً", "What is not normal"], max: 1000 }],
    ] },
  { key: "occlusion", title: ["الإطباق", "Occlusion"], fields: [
    ["molar_right", { kind: "enum", label: ["علاقة الأرحاء — يمين", "Molar relationship — right"], options: [["I", ["الصنف I", "Class I"]], ["II", ["الصنف II", "Class II"]], ["III", ["الصنف III", "Class III"]]] }],
    ["molar_left", { kind: "enum", label: ["علاقة الأرحاء — يسار", "Molar relationship — left"], options: [["I", ["الصنف I", "Class I"]], ["II", ["الصنف II", "Class II"]], ["III", ["الصنف III", "Class III"]]] }],
    ["incisor", { kind: "enum", label: ["علاقة القواطع", "Incisor relationship"], options: [["I", ["الصنف I", "Class I"]], ["II_1", ["الصنف II/1", "Class II/1"]], ["II_2", ["الصنف II/2", "Class II/2"]], ["III", ["الصنف III", "Class III"]]] }],
    ["overjet_mm", { kind: "int", label: ["البروز الأفقي (Overjet)", "Overjet"], min: -10, max: 20, unit: mm }],
    ["overbite_mm", { kind: "int", label: ["البروز العمودي (Overbite)", "Overbite"], min: -10, max: 15, unit: mm }],
    ["crossbite", { kind: "enum", label: ["العضة المعكوسة", "Crossbite"], options: [["none", ["لا يوجد", "None"]], ["anterior", ["أمامية", "Anterior"]], ["posterior_right", ["خلفية يمنى", "Posterior right"]], ["posterior_left", ["خلفية يسرى", "Posterior left"]], ["posterior_both", ["خلفية في الجانبين", "Posterior, both sides"]]] }],
    ["open_bite", { kind: "enum", label: ["العضة المفتوحة", "Open bite"], options: [["none", ["لا يوجد", "None"]], ["anterior", ["أمامية", "Anterior"]], ["posterior", ["خلفية", "Posterior"]]] }],
    ["crowding", { kind: "enum", label: ["الازدحام", "Crowding"], options: [["none", ["لا يوجد", "None"]], ["mild", ["خفيف", "Mild"]], ["moderate", ["متوسط", "Moderate"]], ["severe", ["شديد", "Severe"]]] }],
    ["spacing", { kind: "enum", label: ["الفراغات بين الأسنان", "Spacing"], options: [["none", ["لا يوجد", "None"]], ["present", ["موجودة", "Present"]]] }],
    ["midline_mm", { kind: "int", label: ["انحراف الخط الأوسط", "Midline shift"], min: -10, max: 10, unit: mm }],
    ["note", note],
  ] },
  { key: "hygiene", title: ["النظافة واللثة واللعاب", "Hygiene, gums & saliva"], fields: [
    ["plaque", { kind: "enum", label: ["البلاك", "Plaque"], options: [["none", ["لا يوجد", "None"]], ["light", ["قليل", "Light"]], ["moderate", ["متوسط", "Moderate"]], ["heavy", ["كثيف", "Heavy"]]] }],
    ["calculus", { kind: "enum", label: ["الجير", "Calculus"], options: [["none", ["لا يوجد", "None"]], ["supragingival", ["فوق اللثة", "Supragingival"]], ["subgingival", ["تحت اللثة", "Subgingival"]], ["both", ["فوق اللثة وتحتها", "Both"]]] }],
    ["gingiva", { kind: "enum", label: ["حالة اللثة العامة", "General gum condition"], options: [["healthy", ["سليمة", "Healthy"]], ["gingivitis_localized", ["التهاب موضعي", "Localized gingivitis"]], ["gingivitis_generalized", ["التهاب عام", "Generalized gingivitis"]], ["enlargement", ["تضخّم", "Enlargement"]], ["recession", ["انحسار", "Recession"]]] }],
    ["bleeding", { kind: "enum", label: ["النزف", "Bleeding"], options: [["none", ["لا يوجد", "None"]], ["localized", ["موضعي", "Localized"]], ["generalized", ["عام", "Generalized"]]] }],
    ["saliva", { kind: "enum", label: ["اللعاب", "Saliva"], options: [NA, ["reduced", ["قليل (جفاف)", "Reduced (dry mouth)"]], ["thick", ["لزج", "Thick"]], ["increased", ["زائد", "Increased"]]] }],
    ["halitosis", { kind: "enum", label: ["رائحة الفم", "Halitosis"], options: [["none", ["لا يوجد", "None"]], ["present", ["موجودة", "Present"]]] }],
    ["note", note],
  ] },
];

/** values that need attention, for the summary line (anything not normal / none / healthy / class I) */
const QUIET = new Set(["normal", "none", "healthy", "no_suspicious", "I"]);

/** Checks the sections sent by the form (the database checks again); unknown keys and empty values are dropped. */
export function parseSections(raw: unknown): { sections: Sections } | { error: true } {
  if (raw === null || raw === undefined || raw === "") return { sections: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: true };
  const out: Sections = {};
  for (const sec of EXAM_SECTIONS) {
    const v = (raw as Record<string, unknown>)[sec.key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "object" || Array.isArray(v)) return { error: true };
    const row: Record<string, string | number> = {};
    for (const [k, f] of sec.fields) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined || x === null || x === "") continue;
      if (f.kind === "enum") { if (typeof x !== "string" || !f.options.some(([o]) => o === x)) return { error: true }; row[k] = x; }
      else if (f.kind === "int") { const n = Number(x); if (!Number.isInteger(n) || n < f.min || n > f.max) return { error: true }; row[k] = n; }
      else { const s = String(x).trim().slice(0, f.max); if (s) row[k] = s; }
    }
    if (Object.keys(row).length) out[sec.key] = row;
  }
  return { sections: out };
}

/** One line per section, for lists, the share link and the PDF: what was examined and what was not normal. */
export function summarizeSections(sections: Sections | null | undefined, lang: Lang): { key: SectionKey; title: string; text: string; flag: boolean }[] {
  const i = lang === "ar" ? 0 : 1;
  const out: { key: SectionKey; title: string; text: string; flag: boolean }[] = [];
  for (const sec of EXAM_SECTIONS) {
    const row = sections?.[sec.key];
    if (!row) continue;
    const parts: string[] = []; let flag = false; let quiet = 0;
    for (const [k, f] of sec.fields) {
      const v = row[k];
      if (v === undefined) continue;
      if (f.kind === "text") { parts.push(String(v)); continue; }
      if (f.kind === "int") { parts.push(`${f.label[i]} ${v} ${f.unit[i]}`); continue; }
      const label = f.options.find(([o]) => o === v)?.[1][i] ?? String(v);
      if (QUIET.has(String(v)) && sec.key !== "occlusion") { quiet++; continue; }
      if (sec.key === "soft_tissue" || k === "cancer_screening") flag = flag || v === "abnormal" || v === "suspicious";
      parts.push(`${f.label[i]}: ${label}`);
    }
    if (quiet && !parts.length) parts.push(lang === "ar" ? "طبيعي" : "Normal");
    else if (quiet) parts.unshift(lang === "ar" ? `${quiet} بنود طبيعية` : `${quiet} items normal`);
    out.push({ key: sec.key, title: sec.title[i], text: parts.join(" · "), flag });
  }
  return out;
}

// ---------------------------------------------------------------- pulp tests
export const PULP_TESTS: [string, L][] = [
  ["cold", ["البرودة", "Cold"]], ["heat", ["الحرارة", "Heat"]], ["ept", ["الاختبار الكهربائي", "Electric (EPT)"]],
  ["percussion", ["القرع", "Percussion"]], ["palpation", ["الجس", "Palpation"]], ["bite", ["العض", "Bite"]],
];
export const PULP_RESULTS: [string, L][] = [
  ["normal", ["طبيعي", "Normal"]], ["no_response", ["لا استجابة", "No response"]], ["reduced", ["استجابة ضعيفة", "Reduced"]],
  ["exaggerated", ["استجابة مبالغ فيها", "Exaggerated"]], ["lingering", ["ألم يستمر بعد زوال المؤثر", "Lingering pain"]], ["tender", ["مؤلم", "Tender"]],
];
/** which results make sense for which test */
export const PULP_RESULTS_FOR: Record<string, string[]> = {
  cold: ["normal", "no_response", "reduced", "exaggerated", "lingering"], heat: ["normal", "no_response", "reduced", "exaggerated", "lingering"],
  ept: ["normal", "no_response", "reduced", "exaggerated"], percussion: ["normal", "tender"], palpation: ["normal", "tender"], bite: ["normal", "tender"],
};
export interface PulpTest { tooth: number; test: string; result: string; value?: string; note?: string }
export const pulpLabel = (list: [string, L][], v: string, lang: Lang) => list.find(([k]) => k === v)?.[1][lang === "ar" ? 0 : 1] ?? v;

export function parsePulpTests(raw: unknown): { tests: PulpTest[] } | { error: true } {
  if (raw === null || raw === undefined || raw === "") return { tests: [] };
  if (!Array.isArray(raw) || raw.length > 200) return { error: true };
  const tests: PulpTest[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const tooth = Number(r?.tooth), test = String(r?.test ?? ""), result = String(r?.result ?? "");
    if (!isFdi(tooth) || !PULP_RESULTS_FOR[test]?.includes(result)) return { error: true };
    const value = String(r.value ?? "").trim().slice(0, 40), noteV = String(r.note ?? "").trim().slice(0, 500);
    tests.push({ tooth, test, result, ...(value ? { value } : {}), ...(noteV ? { note: noteV } : {}) });
  }
  return { tests };
}
/** a result worth flagging (a non-vital or symptomatic tooth) */
export const pulpAbnormal = (r: string) => r !== "normal";
