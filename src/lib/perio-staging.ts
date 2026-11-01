import { calOf, marginMeasured, summarize, type PerioTooth, type Site } from "@/lib/perio";

/**
 * The 2017 AAP/EFP classification of periodontal conditions, as a SUGGESTION computed from the chart.
 * The clinician confirms or overrides it; what is stored (perio_exams.dx_*) is what the clinician saved.
 *
 *  - Stage (I–IV): severity and complexity — worst interdental clinical attachment loss (CAL), radiographic bone loss (RBL),
 *    teeth lost to periodontitis, deepest probing depth, furcation involvement.
 *  - Grade (A–C): the risk of progression — RBL as a percentage of the root, divided by age; modified by smoking and diabetes.
 *  - Extent: localized (< 30 % of teeth involved), generalized (≥ 30 %) or molar–incisor pattern.
 */

export type DxKind = "health" | "gingivitis" | "periodontitis" | "other";
export type DxStage = "I" | "II" | "III" | "IV";
export type DxGrade = "A" | "B" | "C";
export type DxExtent = "localized" | "generalized" | "molar_incisor";

type Opt<V extends string> = { value: V; ar: string; en: string };
export const DX_KINDS: Opt<DxKind>[] = [
  { value: "health", ar: "لثة سليمة", en: "Periodontal health" },
  { value: "gingivitis", ar: "التهاب لثة", en: "Gingivitis" },
  { value: "periodontitis", ar: "التهاب دواعم السن", en: "Periodontitis" },
  { value: "other", ar: "حالة أخرى", en: "Other condition" },
];
export const DX_STAGES: DxStage[] = ["I", "II", "III", "IV"];
export const DX_GRADES: DxGrade[] = ["A", "B", "C"];
export const DX_EXTENTS: Opt<DxExtent>[] = [
  { value: "localized", ar: "موضعي (أقل من 30% من الأسنان)", en: "Localized (< 30% of teeth)" },
  { value: "generalized", ar: "معمّم (30% أو أكثر)", en: "Generalized (≥ 30% of teeth)" },
  { value: "molar_incisor", ar: "نمط الأضراس والقواطع", en: "Molar–incisor pattern" },
];

export interface Reason { ar: string; en: string }

/** what is known about the patient that modifies the grade */
export interface PerioFactors {
  ageYears: number | null;
  tobacco: "unknown" | "never" | "former" | "current";
  cigarettesPerDay: number | null;
  diabetes: boolean;
  /** latest HbA1c (%) when known */
  hba1c: number | null;
}

/** interdental sites: the distal and mesial site on each side (0 distobuccal, 2 mesiobuccal, 3 distolingual, 5 mesiolingual) */
export const INTERDENTAL: Site[] = [0, 2, 3, 5];

/**
 * The worst interdental attachment loss on a tooth, counted only where the gingival margin was measured (null when no
 * interdental site has both a depth and a margin): without the margin the attachment level is unknown, not equal to the depth.
 */
export function toothInterdentalCal(t: PerioTooth): number | null {
  if (t.missing) return null;
  const cal = calOf(t);
  if (!cal) return null;
  let max: number | null = null;
  for (const i of INTERDENTAL) {
    const c = cal[i];
    if (c !== null && c !== undefined && marginMeasured(t, i)) max = max === null ? c : Math.max(max, c);
  }
  return max;
}
/** the worst interdental CAL over the chart */
export function maxInterdentalCal(teeth: PerioTooth[]): number | null {
  let max: number | null = null;
  for (const t of teeth) {
    const c = toothInterdentalCal(t);
    if (c !== null) max = max === null ? c : Math.max(max, c);
  }
  return max;
}

export interface StageInput { teeth: PerioTooth[]; rblPct: number | null; teethLostPerio: number | null }
export interface StageResult { stage: DxStage | null; reasons: Reason[] }
const ORDER: DxStage[] = ["I", "II", "III", "IV"];
const rank = (s: DxStage | null) => (s ? ORDER.indexOf(s) : -1);
const maxStage = (a: DxStage | null, b: DxStage | null) => (rank(b) > rank(a) ? b : a);

/**
 * Stage from the worst finding of any criterion:
 *  CAL 1–2 mm → I, 3–4 → II, ≥ 5 → III; RBL < 15 % → I, 15–33 % → II, > 33 % → III;
 *  probing depth ≥ 5 mm → at least II, ≥ 6 mm → at least III; furcation II or III → III;
 *  teeth lost to periodontitis 1–4 → III, ≥ 5 → IV; stage III with fewer than 20 teeth left → IV.
 */
export function suggestStage(i: StageInput): StageResult {
  const reasons: Reason[] = [];
  let stage: DxStage | null = null;
  const add = (s: DxStage, ar: string, en: string) => { stage = maxStage(stage, s); reasons.push({ ar, en }); };

  const cal = maxInterdentalCal(i.teeth);
  if (cal !== null && cal >= 1) {
    const s: DxStage = cal >= 5 ? "III" : cal >= 3 ? "II" : "I";
    add(s, `أقصى فقد ارتباط بين الأسنان ${cal} مم`, `Worst interdental attachment loss ${cal} mm`);
  }
  if (i.rblPct !== null && i.rblPct > 0) {
    const s: DxStage = i.rblPct > 33 ? "III" : i.rblPct >= 15 ? "II" : "I";
    add(s, `فقد العظم الشعاعي ${i.rblPct}%`, `Radiographic bone loss ${i.rblPct}%`);
  }
  const sm = summarize(i.teeth);
  let maxPd: number | null = null;
  for (const t of i.teeth) for (const v of t.missing ? [] : t.pd ?? []) if (v !== null && v !== undefined) maxPd = maxPd === null ? v : Math.max(maxPd, v);
  if (maxPd !== null && maxPd >= 5) {
    add(maxPd >= 6 ? "III" : "II", `أعمق جيب ${maxPd} مم`, `Deepest pocket ${maxPd} mm`);
  }
  const furc = i.teeth.filter((t) => !t.missing && [t.furcation_b, t.furcation_l, t.furcation_m, t.furcation_d].some((f) => (f ?? 0) >= 2));
  if (furc.length) {
    add("III", `انقسام جذور من الدرجة 2 أو 3 (${furc.map((t) => t.tooth).join("، ")})`, `Furcation involvement grade II or III (${furc.map((t) => t.tooth).join(", ")})`);
  }
  const lost = i.teethLostPerio ?? 0;
  if (lost >= 5) add("IV", `فُقدت ${lost} أسنان بسبب التهاب دواعم السن`, `${lost} teeth lost to periodontitis`);
  else if (lost >= 1) add("III", `فُقد ${lost} من الأسنان بسبب التهاب دواعم السن`, `${lost} tooth/teeth lost to periodontitis`);
  if (rank(stage) >= rank("III") && rank(stage) < rank("IV") && sm.missing >= 13) {
    add("IV", `أقل من 20 سناً متبقية (${32 - sm.missing})`, `Fewer than 20 teeth remaining (${32 - sm.missing})`);
  }
  if (stage === null) reasons.push({ ar: "لا يوجد فقد ارتباط أو عظم يُحسب.", en: "No attachment or bone loss to stage." });
  return { stage, reasons };
}

export interface GradeInput { rblPct: number | null; factors: PerioFactors }
export interface GradeResult { grade: DxGrade | null; reasons: Reason[] }
const GRADES: DxGrade[] = ["A", "B", "C"];

/**
 * Grade: the direct evidence is RBL % ÷ age (< 0.25 → A, 0.25–1.0 → B, > 1.0 → C). With no such evidence the grade starts at B.
 * Modifiers can only raise it: a smoker of 10+ cigarettes a day → C, any current smoking → at least B;
 * diabetes with HbA1c ≥ 7 % → C, diabetes otherwise → at least B.
 */
export function suggestGrade(i: GradeInput): GradeResult {
  const reasons: Reason[] = [];
  const f = i.factors;
  let g = 1; // B
  if (i.rblPct !== null && f.ageYears !== null && f.ageYears > 0) {
    const ratio = Math.round((i.rblPct / f.ageYears) * 1000) / 1000;
    g = ratio > 1 ? 2 : ratio < 0.25 ? 0 : 1;
    reasons.push({ ar: `فقد العظم ÷ العمر = ${i.rblPct}% ÷ ${f.ageYears} = ${ratio}`, en: `Bone loss ÷ age = ${i.rblPct}% ÷ ${f.ageYears} = ${ratio}` });
  } else {
    reasons.push({ ar: "لا يوجد فقد عظم شعاعي أو عمر؛ يبدأ التقدير من الدرجة B.", en: "No radiographic bone loss or age; the grade starts at B." });
  }
  const raise = (to: number, ar: string, en: string) => { if (to > g) g = to; reasons.push({ ar, en }); };
  if (f.tobacco === "current") {
    if ((f.cigarettesPerDay ?? 0) >= 10) raise(2, `مدخّن ${f.cigarettesPerDay} سيجارة أو أكثر يومياً`, `Smokes ${f.cigarettesPerDay} or more cigarettes a day`);
    else raise(1, "مدخّن حالي (أقل من 10 سجائر يومياً أو الكمية غير معروفة)", "Current smoker (under 10 a day, or amount unknown)");
  }
  if (f.diabetes) {
    if (f.hba1c !== null && f.hba1c >= 7) raise(2, `سكري بسكر تراكمي ${f.hba1c}%`, `Diabetes with HbA1c ${f.hba1c}%`);
    else raise(1, f.hba1c !== null ? `سكري بسكر تراكمي ${f.hba1c}%` : "سكري (السكر التراكمي غير معروف)", f.hba1c !== null ? `Diabetes with HbA1c ${f.hba1c}%` : "Diabetes (HbA1c unknown)");
  }
  return { grade: GRADES[g], reasons };
}

export interface ExtentResult { extent: DxExtent | null; pct: number | null; involved: number; charted: number; reasons: Reason[] }
/**
 * Extent: the share of charted teeth with interdental CAL ≥ 1 mm. Under 30 % → localized, 30 % or more → generalized;
 * when only first molars and incisors are involved (both kinds) → molar–incisor pattern.
 */
export function suggestExtent(teeth: PerioTooth[]): ExtentResult {
  const charted = teeth.filter((t) => !t.missing && !t.implant && toothInterdentalCal(t) !== null);
  const involved = charted.filter((t) => (toothInterdentalCal(t) ?? 0) >= 1);
  if (!charted.length || !involved.length) {
    return { extent: null, pct: null, involved: involved.length, charted: charted.length, reasons: [{ ar: "لا أسنان مصابة.", en: "No teeth involved." }] };
  }
  const pct = Math.round((involved.length / charted.length) * 100);
  const unit = (t: PerioTooth) => t.tooth % 10;
  const molars = involved.filter((t) => unit(t) === 6).length, incisors = involved.filter((t) => unit(t) === 1 || unit(t) === 2).length;
  const mip = molars > 0 && incisors > 0 && molars + incisors === involved.length;
  const base: Reason = { ar: `${involved.length} من ${charted.length} سناً مصابة (${pct}%)`, en: `${involved.length} of ${charted.length} teeth involved (${pct}%)` };
  if (mip) return { extent: "molar_incisor", pct, involved: involved.length, charted: charted.length, reasons: [base, { ar: "الإصابة في الأضراس الأولى والقواطع فقط", en: "Only first molars and incisors are involved" }] };
  return { extent: pct < 30 ? "localized" : "generalized", pct, involved: involved.length, charted: charted.length, reasons: [base] };
}

export interface DxSuggestion {
  kind: DxKind | null; stage: DxStage | null; grade: DxGrade | null; extent: DxExtent | null;
  kindReasons: Reason[]; stageReasons: Reason[]; gradeReasons: Reason[]; extentReasons: Reason[];
}
/** The whole suggestion. Without probing data nothing is suggested. */
export function suggestDiagnosis(teeth: PerioTooth[], o: { rblPct: number | null; teethLostPerio: number | null; factors: PerioFactors }): DxSuggestion {
  const sm = summarize(teeth);
  const stage = suggestStage({ teeth, rblPct: o.rblPct, teethLostPerio: o.teethLostPerio });
  const ext = suggestExtent(teeth);
  if (sm.sites === 0 && (o.rblPct === null || o.rblPct <= 0)) {
    const none: Reason[] = [{ ar: "لا توجد قياسات بعد.", en: "No measurements yet." }];
    return { kind: null, stage: null, grade: null, extent: null, kindReasons: none, stageReasons: none, gradeReasons: [], extentReasons: [] };
  }
  if (stage.stage === null) {
    const gingivitis = (sm.bopPct ?? 0) >= 10;
    return {
      kind: gingivitis ? "gingivitis" : "health", stage: null, grade: null, extent: null,
      kindReasons: [gingivitis
        ? { ar: `لا فقد ارتباط، والنزف عند السبر ${sm.bopPct}% (10% أو أكثر)`, en: `No attachment loss, bleeding on probing ${sm.bopPct}% (10% or more)` }
        : { ar: `لا فقد ارتباط، والنزف عند السبر ${sm.bopPct ?? 0}% (أقل من 10%)`, en: `No attachment loss, bleeding on probing ${sm.bopPct ?? 0}% (under 10%)` }],
      stageReasons: stage.reasons, gradeReasons: [], extentReasons: [],
    };
  }
  const grade = suggestGrade({ rblPct: o.rblPct, factors: o.factors });
  return {
    kind: "periodontitis", stage: stage.stage, grade: grade.grade, extent: ext.extent,
    kindReasons: [{ ar: "يوجد فقد ارتباط أو عظم", en: "Attachment or bone loss is present" }],
    stageReasons: stage.reasons, gradeReasons: grade.reasons, extentReasons: ext.reasons,
  };
}

/** age in whole years on a date (both YYYY-MM-DD); null when the birth date is missing or later than the date */
export function ageOn(dob: string | null | undefined, on: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const [y, m, d] = dob.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = on.slice(0, 10).split("-").map(Number);
  let age = y2 - y;
  if (m2 < m || (m2 === m && d2 < d)) age--;
  return age >= 0 ? age : null;
}

/** the patient's factors from what the file holds */
export function factorsFrom(o: {
  dob: string | null; on: string; tobaccoStatus?: string | null; cigarettesPerDay?: number | null; diabetes?: boolean; hba1c?: number | null;
}): PerioFactors {
  const tobacco = (["never", "former", "current"] as const).find((x) => x === o.tobaccoStatus) ?? "unknown";
  return { ageYears: ageOn(o.dob, o.on), tobacco, cigarettesPerDay: o.cigarettesPerDay ?? null, diabetes: Boolean(o.diabetes), hba1c: o.hba1c ?? null };
}

// ---------------------------------------------------------------- what the form sends
export interface DxValues {
  dx_kind: DxKind | null; dx_stage: DxStage | null; dx_grade: DxGrade | null; dx_extent: DxExtent | null;
  dx_rbl_pct: number | null; dx_teeth_lost_perio: number | null; dx_note: string | null;
}
/** the diagnosis columns as a row or a form carries them (plain strings) */
export interface DxLike {
  dx_kind?: string | null; dx_stage?: string | null; dx_grade?: string | null; dx_extent?: string | null;
  dx_rbl_pct?: number | null; dx_teeth_lost_perio?: number | null; dx_note?: string | null;
}
export const EMPTY_DX: DxValues = { dx_kind: null, dx_stage: null, dx_grade: null, dx_extent: null, dx_rbl_pct: null, dx_teeth_lost_perio: null, dx_note: null };

/**
 * Reads the diagnosis fields of the form. Stage, grade and extent are kept only for periodontitis; a final chart that names
 * periodontitis must name all three (the database checks it again).
 */
export function parseDx(get: (k: string) => string, finalize: boolean): { dx: DxValues } | { error: "dx_invalid" | "dx_incomplete" } {
  const kind = get("dx_kind").trim();
  if (kind && !DX_KINDS.some((k) => k.value === kind)) return { error: "dx_invalid" };
  const num = (k: string, lo: number, hi: number): number | null | "bad" => {
    const v = get(k).trim();
    if (v === "") return null;
    if (!/^\d{1,3}$/.test(v)) return "bad";
    const n = Number(v);
    return n >= lo && n <= hi ? n : "bad";
  };
  const rbl = num("dx_rbl_pct", 0, 100), lost = num("dx_teeth_lost_perio", 0, 32);
  if (rbl === "bad" || lost === "bad") return { error: "dx_invalid" };
  const perio = kind === "periodontitis";
  const stage = perio ? get("dx_stage").trim() : "", grade = perio ? get("dx_grade").trim() : "", extent = perio ? get("dx_extent").trim() : "";
  if ((stage && !DX_STAGES.includes(stage as DxStage)) || (grade && !DX_GRADES.includes(grade as DxGrade))
      || (extent && !DX_EXTENTS.some((x) => x.value === extent))) return { error: "dx_invalid" };
  if (finalize && perio && !(stage && grade && extent)) return { error: "dx_incomplete" };
  return { dx: {
    dx_kind: (kind || null) as DxKind | null, dx_stage: (stage || null) as DxStage | null, dx_grade: (grade || null) as DxGrade | null,
    dx_extent: (extent || null) as DxExtent | null, dx_rbl_pct: rbl, dx_teeth_lost_perio: lost, dx_note: get("dx_note").trim().slice(0, 2000) || null,
  } };
}

export const dxIsSet = (e: DxLike | null | undefined) => Boolean(e && (e.dx_kind || e.dx_rbl_pct != null || e.dx_teeth_lost_perio != null || e.dx_note));

/** the diagnosis in one line, e.g. "Periodontitis — Stage III, Grade B, generalized" */
export function dxLine(e: DxLike, lang: "ar" | "en"): string {
  const kind = DX_KINDS.find((k) => k.value === e.dx_kind);
  if (!kind) return "";
  const parts: string[] = [kind[lang]];
  const tail: string[] = [];
  if (e.dx_stage) tail.push(`${lang === "ar" ? "المرحلة" : "Stage"} ${e.dx_stage}`);
  if (e.dx_grade) tail.push(`${lang === "ar" ? "الدرجة" : "Grade"} ${e.dx_grade}`);
  const ext = DX_EXTENTS.find((x) => x.value === e.dx_extent);
  if (ext) tail.push(ext[lang].replace(/\s*\(.*\)$/, ""));
  return tail.length ? `${parts[0]} — ${tail.join(lang === "ar" ? "، " : ", ")}` : parts[0];
}

/** the message for a diagnosis error, in the viewer's language */
export function dxErrorText(code: string, t: (a: string, e: string) => string): string | null {
  if (code === "dx_incomplete" || /perio_exams_dx_complete_chk/.test(code))
    return t("التهاب دواعم السن في مخطط معتمد يحتاج المرحلة والدرجة والامتداد.", "Periodontitis on a final chart needs the stage, grade and extent.");
  if (code === "dx_invalid" || /perio_exams_dx_|dx_(kind|stage|grade|extent|rbl_pct|teeth_lost_perio)/.test(code))
    return t("بيانات التشخيص غير صالحة: المرحلة والدرجة والامتداد للالتهاب فقط، وفقد العظم 0–100%، والأسنان المفقودة 0–32.",
             "The diagnosis is invalid: stage, grade and extent go with periodontitis only; bone loss is 0–100 %, teeth lost 0–32.");
  return null;
}
