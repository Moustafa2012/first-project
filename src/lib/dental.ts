import type { Lang } from "@/lib/i18n";
import type { Opt } from "@/lib/labels";

/**
 * Dental chart logic shared by the patient pages, the share viewer and the tests.
 * Teeth use FDI numbers (permanent 11–48, primary 51–85). Surfaces are stored as five canonical codes and named per
 * tooth on screen: O is "incisal" on front teeth, B is "labial" on front teeth, L is "palatal" on upper teeth.
 */

export type Surface = "M" | "D" | "O" | "B" | "L";
export const SURFACES: Surface[] = ["M", "D", "O", "B", "L"];
export type Dentition = "permanent" | "primary" | "mixed";

const o = (value: string, ar: string, en: string): Opt => ({ value, ar, en });

export const TOOTH_STATUS: Opt[] = [
  o("present", "موجود", "Present"),
  o("missing", "مفقود (السبب غير معروف)", "Missing (cause unknown)"),
  o("congenitally_missing", "مفقود خلقياً", "Congenitally missing"),
  o("extracted", "مخلوع", "Extracted"),
  o("unerupted", "لم يبزغ", "Unerupted"),
  o("partially_erupted", "بازغ جزئياً", "Partially erupted"),
  o("impacted", "مطمور", "Impacted"),
  o("not_examined", "لم يُفحص", "Not examined"),
];
export const ABSENT_STATUSES = new Set(["missing", "congenitally_missing", "extracted"]);
export const HIDDEN_STATUSES = new Set(["unerupted", "impacted", "partially_erupted"]);

export const FINDING_KIND: Opt[] = [
  o("caries", "تسوس", "Caries"), o("secondary_caries", "تسوس ثانوي (حول حشوة)", "Secondary caries"),
  o("fracture", "كسر", "Fracture"), o("crack", "شرخ", "Crack"), o("wear", "سحل / تآكل", "Wear / erosion"),
  o("defective_restoration", "حشوة أو تاج معيب", "Defective restoration"), o("periapical_lesion", "آفة ذروية", "Periapical lesion"),
  o("abscess", "خراج", "Abscess"), o("recession", "انحسار اللثة", "Gingival recession"), o("mobility", "حركة السن", "Mobility"),
  o("discoloration", "تلوّن", "Discoloration"), o("hypoplasia", "نقص تكلّس / تنسّج المينا", "Enamel hypoplasia"),
  o("filling", "حشوة", "Filling"), o("sealant", "مادة سادّة للشقوق", "Fissure sealant"), o("inlay_onlay", "حشوة ترصيعية (Inlay/Onlay)", "Inlay / onlay"),
  o("veneer", "قشرة (فينير)", "Veneer"), o("crown", "تاج", "Crown"), o("bridge_abutment", "دعامة جسر", "Bridge abutment"),
  o("bridge_pontic", "سن جسر بديل (Pontic)", "Bridge pontic"), o("root_canal", "علاج عصب (لبّ)", "Root canal treatment"),
  o("post_core", "وتد ولبّ", "Post and core"), o("implant", "زرعة", "Implant"), o("denture", "طقم أسنان", "Denture"),
  o("ortho_appliance", "جهاز تقويم", "Orthodontic appliance"), o("other", "أخرى", "Other"),
];
/** problems to treat (drawn in red) vs work already done (drawn in blue) */
export const DISEASE_KINDS = new Set(["caries", "secondary_caries", "fracture", "crack", "wear", "defective_restoration", "periapical_lesion",
  "abscess", "recession", "mobility", "discoloration", "hypoplasia"]);
/** findings that concern the whole tooth: their surfaces are not asked for */
export const WHOLE_TOOTH_KINDS = new Set(["crown", "bridge_abutment", "bridge_pontic", "root_canal", "post_core", "implant", "denture",
  "ortho_appliance", "periapical_lesion", "abscess", "mobility"]);
/** work that covers every surface of the crown, so the whole tooth is drawn as treated */
export const COVERS_ALL_SURFACES = new Set(["crown", "bridge_abutment", "bridge_pontic", "implant"]);
/** a short code drawn under the tooth for whole-tooth work */
export const KIND_BADGE: Record<string, string> = {
  crown: "CR", bridge_abutment: "BR", bridge_pontic: "PO", root_canal: "RCT", post_core: "PC", implant: "IMP", denture: "DEN",
  ortho_appliance: "ORT", periapical_lesion: "PA", abscess: "ABS", mobility: "MOB", veneer: "VEN",
};

export const EVIDENCE: Opt[] = [
  o("patient_reported", "إفادة المريض", "Patient-reported"), o("clinical", "فحص سريري", "Clinical examination"),
  o("radiographic", "صورة أشعة", "Radiograph"), o("clinical_radiographic", "سريري وشعاعي", "Clinical and radiographic"),
  o("unknown", "غير محدد", "Not stated"),
];
export const FINDING_SEVERITY: Opt[] = [o("initial", "بدائي", "Initial"), o("moderate", "متوسط", "Moderate"), o("advanced", "متقدم", "Advanced")];
export const MATERIAL: Opt[] = [
  o("amalgam", "أملغم (فضية)", "Amalgam"), o("composite", "كومبوزيت (تجميلية)", "Composite"), o("glass_ionomer", "زجاج شاردي", "Glass ionomer"),
  o("ceramic", "خزف", "Ceramic"), o("metal", "معدن", "Metal"), o("zirconia", "زيركون", "Zirconia"), o("gold", "ذهب", "Gold"),
  o("temporary", "مؤقتة", "Temporary"), o("other", "أخرى", "Other"),
];
export const EXAM_KIND: Opt[] = [
  o("comprehensive", "فحص شامل", "Comprehensive exam"), o("periodic", "فحص دوري", "Periodic exam"), o("limited", "فحص محدود", "Limited exam"),
  o("emergency", "فحص طارئ", "Emergency exam"), o("orthodontic", "فحص تقويم", "Orthodontic exam"),
  o("self_report", "إفادة المريض (ليس فحصاً سريرياً)", "Patient's own account (not a clinical exam)"), o("other", "أخرى", "Other"),
];
export const DENTITION: Opt[] = [o("permanent", "دائمة", "Permanent"), o("primary", "لبنية", "Primary"), o("mixed", "مختلطة", "Mixed")];
export const ORAL_HYGIENE: Opt[] = [o("good", "جيدة", "Good"), o("fair", "مقبولة", "Fair"), o("poor", "ضعيفة", "Poor")];
export const BRUSHING: Opt[] = [o("none", "لا يفرّش", "Does not brush"), o("irregular", "غير منتظم", "Irregularly"), o("once", "مرة يومياً", "Once a day"),
  o("twice", "مرتين يومياً", "Twice a day"), o("more", "أكثر من مرتين", "More than twice")];
export const FLOSSING: Opt[] = [o("never", "لا يستخدم الخيط", "Never"), o("sometimes", "أحياناً", "Sometimes"), o("daily", "يومياً", "Daily")];
export const ANXIETY: Opt[] = [o("none", "لا يوجد", "None"), o("mild", "خفيف", "Mild"), o("moderate", "متوسط", "Moderate"), o("severe", "شديد", "Severe")];

// ---------------------------------------------------------------- numbering
export const isFdi = (n: number): boolean => {
  if (!Number.isInteger(n)) return false;
  const q = Math.floor(n / 10), u = n % 10;
  return (q >= 1 && q <= 4 && u >= 1 && u <= 8) || (q >= 5 && q <= 8 && u >= 1 && u <= 5);
};
export const quadrant = (n: number) => Math.floor(n / 10);
export const isPrimary = (n: number) => quadrant(n) >= 5;
export const isUpper = (n: number) => [1, 2, 5, 6].includes(quadrant(n));
/** the patient's right side (drawn on the viewer's left, as when facing the patient) */
export const isPatientRight = (n: number) => [1, 4, 5, 8].includes(quadrant(n));
export const isAnterior = (n: number) => n % 10 <= 3;
export type ToothType = "incisor" | "canine" | "premolar" | "molar";
export function toothType(n: number): ToothType {
  const u = n % 10;
  if (isPrimary(n)) return u <= 2 ? "incisor" : u === 3 ? "canine" : "molar";
  return u <= 2 ? "incisor" : u === 3 ? "canine" : u <= 5 ? "premolar" : "molar";
}

const range = (q: number, from: number, to: number) => {
  const out: number[] = [];
  for (let u = from; from <= to ? u <= to : u >= to; u += from <= to ? 1 : -1) out.push(q * 10 + u);
  return out;
};
/** rows as seen when facing the patient: patient's right on the left */
export const ARCHES = {
  permanentUpper: [...range(1, 8, 1), ...range(2, 1, 8)],
  permanentLower: [...range(4, 8, 1), ...range(3, 1, 8)],
  primaryUpper: [...range(5, 5, 1), ...range(6, 1, 5)],
  primaryLower: [...range(8, 5, 1), ...range(7, 1, 5)],
};
export function archesFor(d: Dentition): number[][] {
  if (d === "primary") return [ARCHES.primaryUpper, ARCHES.primaryLower];
  if (d === "mixed") return [ARCHES.permanentUpper, ARCHES.primaryUpper, ARCHES.primaryLower, ARCHES.permanentLower];
  return [ARCHES.permanentUpper, ARCHES.permanentLower];
}

const TOOTH_NAME: Record<ToothType, [string, string]> = {
  incisor: ["قاطع", "incisor"], canine: ["ناب", "canine"], premolar: ["ضاحك", "premolar"], molar: ["رحى", "molar"],
};
export function toothName(n: number, lang: Lang): string {
  const u = n % 10, type = toothType(n);
  const side = isUpper(n) ? (lang === "ar" ? "علوي" : "upper") : (lang === "ar" ? "سفلي" : "lower");
  const lr = isPatientRight(n) ? (lang === "ar" ? "أيمن" : "right") : (lang === "ar" ? "أيسر" : "left");
  const prim = isPrimary(n) ? (lang === "ar" ? " لبني" : " primary") : "";
  let which = "";
  if (type === "incisor") which = u === 1 ? (lang === "ar" ? " مركزي" : " central") : (lang === "ar" ? " جانبي" : " lateral");
  else if (type === "premolar") which = u === 4 ? (lang === "ar" ? " أول" : " first") : (lang === "ar" ? " ثانٍ" : " second");
  else if (type === "molar") {
    const k = isPrimary(n) ? u - 3 : u - 5;
    which = lang === "ar" ? [" أول", " ثانٍ", " ثالث (عقل)"][k - 1] ?? "" : [" first", " second", " third (wisdom)"][k - 1] ?? "";
  }
  return lang === "ar" ? `${TOOTH_NAME[type][0]}${which}${prim} ${side} ${lr}` : `${side} ${lr}${which}${prim} ${TOOTH_NAME[type][1]}`;
}

// ---------------------------------------------------------------- surfaces
/** the letter shown for a stored surface on this tooth */
export function surfaceCode(s: Surface, tooth: number): string {
  if (s === "O") return isAnterior(tooth) ? "I" : "O";
  if (s === "B") return isAnterior(tooth) ? "La" : "B";
  if (s === "L") return isUpper(tooth) ? "P" : "L";
  return s;
}
export function surfaceName(s: Surface, tooth: number, lang: Lang): string {
  const ar = lang === "ar";
  switch (s) {
    case "M": return ar ? "إنسي" : "Mesial";
    case "D": return ar ? "وحشي" : "Distal";
    case "O": return isAnterior(tooth) ? (ar ? "قاطع" : "Incisal") : (ar ? "إطباقي" : "Occlusal");
    case "B": return isAnterior(tooth) ? (ar ? "شفوي" : "Labial") : (ar ? "دهليزي (خدّي)" : "Buccal");
    case "L": return isUpper(tooth) ? (ar ? "حنكي" : "Palatal") : (ar ? "لساني" : "Lingual");
  }
}
/** "MOD"-style label in the conventional order */
export function fmtSurfaces(surfaces: readonly string[] | null | undefined, tooth: number): string {
  const set = new Set(surfaces ?? []);
  return (["M", "O", "D", "B", "L"] as Surface[]).filter((s) => set.has(s)).map((s) => surfaceCode(s, tooth)).join("");
}
/** where a surface is drawn on the five-part tooth diagram (facial surfaces face away from the bite) */
export function surfaceSide(s: Surface, tooth: number): "left" | "right" | "top" | "bottom" | "center" {
  if (s === "O") return "center";
  if (s === "B") return isUpper(tooth) ? "top" : "bottom";
  if (s === "L") return isUpper(tooth) ? "bottom" : "top";
  // mesial faces the midline: right for the patient's right side (drawn on the left), left otherwise
  const towardMid = isPatientRight(tooth) ? "right" : "left";
  const away = towardMid === "right" ? "left" : "right";
  return s === "M" ? towardMid : away;
}
/** keyboard letter -> stored surface for this tooth (accepts I, La, P as aliases) */
export function surfaceFromKey(key: string, tooth: number): Surface | null {
  const k = key.toUpperCase();
  if (k === "M" || k === "D" || k === "O" || k === "B" || k === "L") return k;
  if (k === "I") return isAnterior(tooth) ? "O" : null;
  if (k === "P") return isUpper(tooth) ? "L" : null;
  return null;
}

/** "16, 26 36" -> [16, 26, 36]; null when anything is not an FDI tooth */
export function parseTeeth(raw: string | null | undefined): number[] | null {
  const parts = String(raw ?? "").split(/[\s,،;]+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
    if (!isFdi(n)) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- deriving the chart
export interface ToothStateRow { tooth: number; status: string; note?: string | null }
export interface ExamRow {
  id: string; exam_date: string; recorded_at?: string | null; kind: string; dentition: string; examiner_name?: string | null;
  facility_name?: string | null; chief_complaint?: string | null; oral_hygiene?: string | null; notes?: string | null; source?: string | null;
  source_detail?: string | null; verification?: string | null; contributed_by?: string | null; states: ToothStateRow[];
}
export interface FindingRow {
  id: string; exam_id: string | null; condition_id?: string | null; tooth: number; surfaces: string[]; kind: string; evidence: string;
  severity?: string | null; material?: string | null; observed_on: string; date_precision?: string | null; resolved_on?: string | null;
  resolved_note?: string | null; notes?: string | null; source?: string | null; source_detail?: string | null; verification?: string | null;
  contributed_by?: string | null; recorded_at?: string | null;
}
export interface ToothView {
  tooth: number;
  /** from the latest exam that looked at this tooth; null = never examined */
  status: string | null;
  statusDate: string | null;
  statusExamId: string | null;
  /** unresolved findings, newest first */
  findings: FindingRow[];
}

const byExamOrder = (a: ExamRow, b: ExamRow) => a.exam_date.localeCompare(b.exam_date) || String(a.recorded_at ?? "").localeCompare(String(b.recorded_at ?? ""));

export function deriveChart(exams: ExamRow[], findings: FindingRow[], asOf?: string): Map<number, ToothView> {
  const out = new Map<number, ToothView>();
  const get = (t: number) => {
    let v = out.get(t);
    if (!v) { v = { tooth: t, status: null, statusDate: null, statusExamId: null, findings: [] }; out.set(t, v); }
    return v;
  };
  for (const e of [...exams].sort(byExamOrder)) {
    if (asOf && e.exam_date > asOf) continue;
    for (const s of e.states) {
      if (s.status === "not_examined") continue;   // an exam that skipped the tooth does not erase what was known
      const v = get(s.tooth);
      v.status = s.status; v.statusDate = e.exam_date; v.statusExamId = e.id;
    }
  }
  for (const f of findings) {
    if (asOf && f.observed_on > asOf) continue;
    if (f.resolved_on && (!asOf || f.resolved_on <= asOf)) continue;
    get(f.tooth).findings.push(f);
  }
  for (const v of out.values()) v.findings.sort((a, b) => b.observed_on.localeCompare(a.observed_on));
  return out;
}

/** the dentition to draw: the profile's, else the latest exam's, else permanent */
export function chartDentition(profile: { dentition?: string | null } | null | undefined, exams: ExamRow[]): Dentition {
  const d = profile?.dentition ?? [...exams].sort(byExamOrder).at(-1)?.dentition;
  return d === "primary" || d === "mixed" ? d : "permanent";
}

/** surface colour class for the chart: disease wins over existing work */
export function surfaceTone(findings: Pick<FindingRow, "kind" | "surfaces">[], s: Surface): "disease" | "work" | null {
  let tone: "disease" | "work" | null = null;
  for (const f of findings) {
    if (COVERS_ALL_SURFACES.has(f.kind)) { tone ??= "work"; continue; }
    if (!f.surfaces.includes(s)) continue;
    if (DISEASE_KINDS.has(f.kind)) return "disease";
    tone = "work";
  }
  return tone;
}

export interface ExamChange { tooth: number; before: string | null; after: string | null; added: FindingRow[]; removed: FindingRow[] }
const findingKey = (f: FindingRow) => `${f.kind}:${[...f.surfaces].sort().join("")}`;

/** what changed for each tooth between two exams (tooth states and the findings recorded in each) */
export function compareExams(a: ExamRow, b: ExamRow, findings: FindingRow[]): ExamChange[] {
  const [older, newer] = byExamOrder(a, b) <= 0 ? [a, b] : [b, a];
  const st = (e: ExamRow) => new Map(e.states.filter((s) => s.status !== "not_examined").map((s) => [s.tooth, s.status]));
  const sa = st(older), sb = st(newer);
  const fa = findings.filter((f) => f.exam_id === older.id), fb = findings.filter((f) => f.exam_id === newer.id);
  const teeth = new Set<number>([...sa.keys(), ...sb.keys(), ...fa.map((f) => f.tooth), ...fb.map((f) => f.tooth)]);
  const out: ExamChange[] = [];
  for (const t of [...teeth].sort((x, y) => x - y)) {
    const ka = new Set(fa.filter((f) => f.tooth === t).map(findingKey));
    const kb = new Set(fb.filter((f) => f.tooth === t).map(findingKey));
    const added = fb.filter((f) => f.tooth === t && !ka.has(findingKey(f)));
    const removed = fa.filter((f) => f.tooth === t && !kb.has(findingKey(f)));
    const before = sa.get(t) ?? null, after = sb.get(t) ?? null;
    if (before !== after || added.length || removed.length) out.push({ tooth: t, before, after, added, removed });
  }
  return out;
}

/** counts for the summary line under the chart */
export function chartSummary(chart: Map<number, ToothView>) {
  let examined = 0, absent = 0, disease = 0, work = 0;
  for (const v of chart.values()) {
    if (v.status) examined++;
    if (v.status && ABSENT_STATUSES.has(v.status)) absent++;
    if (v.findings.some((f) => DISEASE_KINDS.has(f.kind))) disease++;
    if (v.findings.some((f) => !DISEASE_KINDS.has(f.kind))) work++;
  }
  return { examined, absent, disease, work };
}

// ---------------------------------------------------------------- the exam form (patient page and share link)
export interface ExamPayload {
  exam: Record<string, string>;
  states: { tooth: number; status: string; note?: string }[];
  findings: { tooth: number; surfaces: Surface[]; kind: string; evidence: string; severity?: string; material?: string; notes?: string; condition_id?: string }[];
}
const has = (list: Opt[], v: unknown) => typeof v === "string" && list.some((x) => x.value === v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads and checks an exam submitted as form fields + two JSON lists (states, findings). The database checks again. */
export function parseExamForm(fd: FormData, t: (ar: string, en: string) => string, today: string): ExamPayload | { error: string } {
  const g = (k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
  const exam: Record<string, string> = {};
  const date = g("exam_date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: t("أدخل تاريخ الفحص.", "Enter the exam date.") };
  if (date > today) return { error: t("تاريخ الفحص في المستقبل.", "The exam date is in the future.") };
  exam.exam_date = date;
  const kind = g("kind") || "comprehensive", dentition = g("dentition") || "permanent", hyg = g("oral_hygiene");
  if (!has(EXAM_KIND, kind) || !has(DENTITION, dentition) || (hyg && !has(ORAL_HYGIENE, hyg))) return { error: t("اختيار غير صالح.", "Invalid choice.") };
  exam.kind = kind; exam.dentition = dentition; if (hyg) exam.oral_hygiene = hyg;
  for (const [k, max] of [["examiner_name", 200], ["facility_name", 200], ["chief_complaint", 1000], ["notes", 4000]] as const) {
    const v = g(k, max + 1);
    if (v.length > max) return { error: t("النص طويل جداً.", "Text too long.") };
    if (v) exam[k] = v;
  }
  const enc = g("encounter_id", 40);
  if (enc) { if (!UUID.test(enc)) return { error: t("زيارة غير صالحة.", "Invalid visit.") }; exam.encounter_id = enc; }

  let rawStates: unknown, rawFindings: unknown;
  try { rawStates = JSON.parse(String(fd.get("states") || "[]")); rawFindings = JSON.parse(String(fd.get("findings") || "[]")); }
  catch { return { error: t("بيانات المخطط غير صالحة.", "Invalid chart data.") }; }
  if (!Array.isArray(rawStates) || !Array.isArray(rawFindings) || rawStates.length > 60 || rawFindings.length > 200) {
    return { error: t("بيانات المخطط غير صالحة.", "Invalid chart data.") };
  }
  const states: ExamPayload["states"] = [];
  const seen = new Set<number>();
  for (const s of rawStates as Record<string, unknown>[]) {
    const tooth = Number(s?.tooth);
    if (!isFdi(tooth) || seen.has(tooth) || !has(TOOTH_STATUS, s?.status)) return { error: t("حالة سن غير صالحة.", "Invalid tooth state.") };
    seen.add(tooth);
    const note = String(s.note ?? "").trim().slice(0, 500);
    states.push({ tooth, status: s.status as string, ...(note ? { note } : {}) });
  }
  const findings: ExamPayload["findings"] = [];
  for (const f of rawFindings as Record<string, unknown>[]) {
    const tooth = Number(f?.tooth);
    const surfaces = Array.isArray(f?.surfaces) ? (f.surfaces as unknown[]).map(String) : [];
    if (!isFdi(tooth) || !has(FINDING_KIND, f?.kind) || !has(EVIDENCE, f?.evidence ?? "unknown")
        || surfaces.some((x) => !SURFACES.includes(x as Surface)) || new Set(surfaces).size !== surfaces.length
        || (f.severity && !has(FINDING_SEVERITY, f.severity)) || (f.material && !has(MATERIAL, f.material))
        || (f.condition_id && !UUID.test(String(f.condition_id)))) {
      return { error: t("موجود سني غير صالح.", "Invalid dental finding.") };
    }
    const notes = String(f.notes ?? "").trim().slice(0, 2000);
    findings.push({
      tooth, surfaces: WHOLE_TOOTH_KINDS.has(f.kind as string) ? [] : (surfaces as Surface[]), kind: f.kind as string, evidence: (f.evidence as string) ?? "unknown",
      ...(f.severity ? { severity: f.severity as string } : {}), ...(f.material ? { material: f.material as string } : {}),
      ...(notes ? { notes } : {}), ...(f.condition_id ? { condition_id: String(f.condition_id) } : {}),
    });
  }
  if (states.length === 0 && findings.length === 0) return { error: t("سجّل حالة سن واحد أو موجوداً واحداً على الأقل.", "Record at least one tooth state or finding.") };
  return { exam, states, findings };
}
