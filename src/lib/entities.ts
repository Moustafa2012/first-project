import * as L from "@/lib/labels";
import type { Opt } from "@/lib/labels";
import type { Lang } from "@/lib/i18n";
import type { Row } from "@/lib/types";
import { normText } from "@/lib/dedupe";
import { isWholeMouth, summarizeBoneLevels, type BoneLevels } from "@/lib/dental-imaging";

export type FieldKind = "text" | "textarea" | "date" | "datetime" | "number" | "select" | "checkbox" | "specialty" | "teeth"
  /** the bone level read per sextant on a dental image (stored as jsonb, see src/lib/dental-imaging.ts) */
  | "bonelevels"
  /** the open imaging request this study fulfils (offered from FormContext.orders) */
  | "imaging_order"
  /** a record of the same file, e.g. the condition a symptom belongs to (offered from FormContext.choices) */
  | "link";

export interface FieldDef {
  name: string;
  ar: string;
  en: string;
  kind: FieldKind;
  required?: boolean;
  options?: Opt[];
  step?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  wide?: boolean;
  rows?: number;
  hint?: [string, string];
  blank?: boolean;          // datetime: start empty instead of "now"
  dflt?: string | boolean;
  /** shown on the card as a labelled line */
  show?: boolean;
  /** date fields: name of the column that says how much of the date is known (day / month / year / approx) */
  precision?: string;
  /** shown only where it makes sense (e.g. tooth numbers in the dental file) */
  only?: "dental";
}

/**
 * Where a form is opened from. Values the place already knows (the specialty of a specialty page, "diagnosis" in the
 * dental file…) are sent as hidden fields and never asked; `dental` shows the dental-only fields; `options` narrows a
 * select (e.g. chronic categories in the core file).
 */
export interface FormContext {
  fixed?: Record<string, string>;
  dental?: boolean;
  options?: Record<string, string[]>;
  /** suggestions offered while typing a text field (e.g. common dental diagnoses) */
  suggest?: Record<string, string[]>;
  /** fields filled by a control outside the form (`form="…"`), e.g. the tooth chosen on the chart */
  external?: string[];
  /** only these fields are asked (a short form in a tight place); the rest keep their defaults */
  pick?: string[];
  /** note templates offered above the text */
  templates?: { id: string; title: string; body: string; mine?: boolean }[];
  /** open imaging requests a new study can fulfil */
  orders?: { id: string; label: string }[];
  /** choices of "link" fields (a record of the same file, e.g. the condition a symptom belongs to) */
  choices?: Record<string, Opt[]>;
}
const teethChip = (r: Row, lang: Lang): Chip[] =>
  Array.isArray(r.teeth) && r.teeth.length ? [{ tone: "info", text: `${lang === "ar" ? "الأسنان" : "Teeth"}: ${(r.teeth as number[]).join(", ")}` }] : [];
const teethField = (): FieldDef => ({ name: "teeth", ar: "الأسنان المعنية", en: "Teeth concerned", kind: "teeth", only: "dental",
  hint: ["أرقام FDI مفصولة بفاصلة، مثل: 16، 26", "FDI numbers separated by commas, e.g. 16, 26"] });

export interface Chip { tone: "ok" | "warn" | "bad" | "info" | "muted"; text: string }

export interface EntityDef {
  slug: string;
  table: string;
  ar: string;
  en: string;
  singular: { ar: string; en: string };
  fields: FieldDef[];
  order: [string, "asc" | "desc"];
  titleOf: (r: Row, lang: Lang) => string;
  chipsOf?: (r: Row, lang: Lang) => Chip[];
  /** date shown next to the title */
  dateOf?: (r: Row) => string | null;
  dateKind?: "date" | "datetime";
  bodyField?: string;
  hasSpecialty: boolean;
  /** columns allowed for filtering by encounter / condition links */
  links?: string[];
  /** column holding the precision of the date returned by dateOf */
  datePrecision?: string;
  /**
   * Key used to warn about a probable duplicate before inserting: two live rows with the same key are "the same
   * thing entered twice". Returning null means the row is never compared (e.g. a closed test request).
   */
  dupKey?: (r: Row) => string | null;
}

const s = (r: Row, k: string) => (r[k] == null ? "" : String(r[k]));
/** minute-level instant, so a value read back from the database matches the one just submitted */
const minute = (v: unknown) => { if (v == null || v === "") return ""; const d = new Date(String(v)); return Number.isNaN(+d) ? String(v) : d.toISOString().slice(0, 16); };
const day = (v: unknown) => (v == null ? "" : String(v).slice(0, 10));
const n = (r: Row, k: string) => normText(r[k]);
const PREC = "date_precision";
const unknownDate: [string, string] = ["اتركه فارغاً إن كان التاريخ غير معروف، أو اختر الدقة المعروفة (الشهر أو السنة فقط).", "Leave empty if the date is unknown, or choose how much of it is known (month or year only)."];
const partialDate: [string, string] = ["إن لم يُعرف اليوم اختر «الشهر فقط» أو «السنة فقط» أو «سنة تقريبية»، ثم أي يوم من تلك الفترة.", "If the exact day is unknown choose “Month only”, “Year only” or “Approximate year”, then any day in that period."];
const f = (name: string, ar: string, en: string, kind: FieldKind, extra: Partial<FieldDef> = {}): FieldDef => ({ name, ar, en, kind, ...extra });
const spec = f("specialty_id", "التخصص", "Specialty", "specialty", { hint: ["اربط السجل بقسم طبي ليظهر في ملفه وتشمله مشاركته.", "Link to a specialty so it appears in that file and in its shares."] });

const tone = (v: string, map: Record<string, Chip["tone"]>): Chip["tone"] => map[v] ?? "muted";

export const ENTITIES: Record<string, EntityDef> = {
  conditions: {
    slug: "conditions", table: "conditions", ar: "الأمراض والتشخيصات", en: "Conditions & diagnoses", singular: { ar: "تشخيص أو مرض", en: "condition" },
    order: ["onset_date", "desc"], hasSpecialty: true, bodyField: "notes", dateOf: (r) => (r.onset_date as string) ?? null, datePrecision: PREC, links: ["encounter_id"],
    titleOf: (r) => s(r, "name"), dupKey: (r) => n(r, "name"),
    chipsOf: (r, lang) => [
      { tone: r.category === "chronic" || r.category === "congenital" ? "info" : "muted", text: L.lbl(L.CONDITION_CATEGORY, s(r, "category"), lang) },
      { tone: tone(s(r, "clinical_status"), { active: "warn", recurrence: "warn", resolved: "ok", remission: "ok" }), text: L.lbl(L.CLINICAL_STATUS, s(r, "clinical_status"), lang) },
      { tone: s(r, "certainty") === "confirmed" ? "ok" : "muted", text: L.lbl(L.CERTAINTY, s(r, "certainty"), lang) },
      ...(r.severity ? [{ tone: "muted" as const, text: L.lbl(L.SEVERITY3, s(r, "severity"), lang) }] : []),
      ...(r.sensitive ? [{ tone: "warn" as const, text: lang === "ar" ? "حساس" : "Sensitive" }] : []),
      ...teethChip(r, lang),
    ],
    fields: [
      f("name", "اسم المرض / التشخيص", "Condition / diagnosis", "text", { required: true, maxLength: 200, wide: true }),
      f("category", "التصنيف", "Category", "select", { options: L.CONDITION_CATEGORY, dflt: "chronic" }),
      f("clinical_status", "وضعه الآن", "Current status", "select", { options: L.CLINICAL_STATUS, dflt: "active" }),
      f("certainty", "درجة التأكد", "Certainty", "select", { options: L.CERTAINTY, dflt: "unknown", hint: ["«مؤكد» فقط إن أكده مقدم رعاية. اتركه «غير معروف» عند الشك.", "Use “Confirmed” only when a care provider confirmed it."] }),
      f("severity", "الشدة", "Severity", "select", { options: L.SEVERITY3 }),
      f("onset_date", "تاريخ البداية", "Onset date", "date", { precision: PREC, hint: partialDate }),
      f("resolved_date", "تاريخ الشفاء / الانتهاء", "Resolved date", "date"),
      f("icd10_code", "رمز ICD-10 (اختياري)", "ICD-10 code (optional)", "text", { maxLength: 12 }),
      spec,
      teethField(),
      f("evidence", "أساس التشخيص", "Basis of the diagnosis", "select", { options: L.DIAGNOSIS_EVIDENCE }),
      f("sensitive", "تشخيص حساس (لا يُشارك إلا بإذن صريح)", "Sensitive (shared only when explicitly allowed)", "checkbox"),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  allergies: {
    slug: "allergies", table: "allergies", ar: "الحساسية", en: "Allergies", singular: { ar: "حساسية", en: "allergy" },
    order: ["recorded_at", "desc"], hasSpecialty: true, bodyField: "notes", dateOf: (r) => (r.onset_date as string) ?? null,
    titleOf: (r) => s(r, "substance"), dupKey: (r) => n(r, "substance"),
    chipsOf: (r, lang) => [
      { tone: "info", text: L.lbl(L.ALLERGY_CATEGORY, s(r, "category"), lang) },
      { tone: tone(s(r, "severity"), { life_threatening: "bad", severe: "bad", moderate: "warn", mild: "muted" }), text: L.lbl(L.ALLERGY_SEVERITY, s(r, "severity"), lang) },
      { tone: s(r, "certainty") === "confirmed" ? "ok" : "muted", text: L.lbl(L.ALLERGY_CERTAINTY, s(r, "certainty"), lang) },
      { tone: s(r, "status") === "active" ? "warn" : "muted", text: L.lbl(L.ALLERGY_STATUS, s(r, "status"), lang) },
    ],
    fields: [
      f("substance", "المادة المسببة", "Substance", "text", { required: true, wide: true, maxLength: 200 }),
      f("category", "النوع", "Type", "select", { options: L.ALLERGY_CATEGORY }),
      f("reaction", "وصف التفاعل", "Reaction", "text", { wide: true }),
      f("severity", "الشدة الموثقة", "Documented severity", "select", { options: L.ALLERGY_SEVERITY, dflt: "unknown" }),
      f("status", "الحالة", "Status", "select", { options: L.ALLERGY_STATUS, dflt: "active" }),
      f("certainty", "التوثيق", "Verification", "select", { options: L.ALLERGY_CERTAINTY, dflt: "unverified" }),
      f("onset_date", "تاريخ الحدوث", "Date it occurred", "date"),
      spec,
      f("notes", "ملاحظات طبية", "Medical notes", "textarea", { wide: true }),
    ],
  },
  medications: {
    slug: "medications", table: "medications", ar: "الأدوية", en: "Medications", singular: { ar: "دواء", en: "medication" },
    order: ["start_date", "desc"], hasSpecialty: true, bodyField: "instructions", dateOf: (r) => (r.start_date as string) ?? null, datePrecision: PREC, links: ["encounter_id", "condition_id"],
    dupKey: (r) => `${n(r, "name_generic")}|${n(r, "name_brand")}|${day(r.start_date)}`,
    titleOf: (r) => [s(r, "name_generic"), s(r, "name_brand") && `(${s(r, "name_brand")})`, s(r, "strength")].filter(Boolean).join(" "),
    chipsOf: (r, lang) => [
      { tone: tone(s(r, "status"), { active: "ok", on_hold: "warn" }), text: L.lbl(L.MED_STATUS, s(r, "status"), lang) },
      { tone: "info", text: L.lbl(L.MED_ORIGIN, s(r, "origin"), lang) },
      ...(r.long_term ? [{ tone: "info" as const, text: lang === "ar" ? "دواء دائم" : "Long-term" }] : []),
      ...(r.as_needed ? [{ tone: "muted" as const, text: lang === "ar" ? "عند الحاجة" : "As needed" }] : []),
      ...(r.sensitive ? [{ tone: "warn" as const, text: lang === "ar" ? "حساس" : "Sensitive" }] : []),
    ],
    fields: [
      f("name_generic", "الاسم العلمي", "Generic name", "text", { maxLength: 200 }),
      f("name_brand", "الاسم التجاري", "Brand name", "text", { maxLength: 200, hint: ["يلزم أحد الاسمين على الأقل.", "At least one name is required."] }),
      f("strength", "التركيز", "Strength", "text", { maxLength: 60 }),
      f("form", "الشكل الدوائي", "Form", "select", { options: L.MED_FORM }),
      f("dose", "الجرعة", "Dose", "text", { maxLength: 100 }),
      f("route", "طريق الإعطاء", "Route", "select", { options: L.MED_ROUTE }),
      f("frequency", "التكرار", "Frequency", "text", { maxLength: 100 }),
      f("quantity", "الكمية الموصوفة", "Quantity prescribed", "text", { maxLength: 60, show: true, hint: ["مثل: 21 كبسولة، أو علبة واحدة.", "e.g. 21 capsules, or 1 box."] }),
      f("duration_days", "مدة الاستخدام (أيام)", "Duration (days)", "number", { min: 1, max: 3650, step: "1", show: true }),
      f("refills", "مرات التجديد", "Refills", "number", { min: 0, max: 24, step: "1", show: true }),
      f("long_term", "دواء دائم (يُؤخذ باستمرار)", "Long-term (taken continuously)", "checkbox"),
      f("as_needed", "عند الحاجة فقط", "Only when needed", "checkbox"),
      f("origin", "مصدر المعلومة", "How we know", "select", { options: L.MED_ORIGIN, dflt: "patient_reported" }),
      f("status", "الحالة", "Status", "select", { options: L.MED_STATUS, dflt: "active", hint: ["لا تُعد الأدوية القديمة فعّالة: غيّر الحالة عند إيقافها.", "Old medications are not assumed active — change the status when stopped."] }),
      f("start_date", "تاريخ البدء", "Start date", "date", { precision: PREC, hint: partialDate }),
      f("end_date", "تاريخ الإيقاف", "Stop date", "date"),
      f("stopped_by", "أُوقف بواسطة", "Stopped by", "select", { options: L.MED_STOPPED_BY }),
      f("stop_reason", "سبب الإيقاف", "Reason stopped", "text", { wide: true }),
      f("indication", "سبب الاستخدام", "Reason for use", "text", { wide: true }),
      f("prescriber_name", "الطبيب الواصف", "Prescriber", "text"),
      spec,
      f("instructions", "تعليمات الاستخدام", "Instructions", "textarea", { wide: true }),
      f("adverse_effects", "آثار جانبية / تفاعلات موثقة", "Documented side effects / interactions", "textarea", { wide: true }),
      f("sensitive", "دواء حساس (لا يُشارك إلا بإذن صريح)", "Sensitive (shared only when explicitly allowed)", "checkbox"),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  visits: {
    slug: "visits", table: "encounters", ar: "الزيارات الطبية", en: "Visits & encounters", singular: { ar: "زيارة", en: "visit" },
    order: ["started_at", "desc"], hasSpecialty: true, dateOf: (r) => (r.started_at as string) ?? null, dateKind: "datetime", bodyField: "summary",
    titleOf: (r, lang) => [L.lbl(L.ENCOUNTER_KIND, s(r, "kind"), lang), s(r, "reason")].filter(Boolean).join(" — "),
    dupKey: (r) => `${s(r, "kind")}|${minute(r.started_at)}`,
    chipsOf: (r, lang) => [{ tone: tone(s(r, "status"), { completed: "ok", planned: "info", in_progress: "warn" }), text: L.lbl(L.ENCOUNTER_STATUS, s(r, "status"), lang) },
      ...teethChip(r, lang), ...(r.anesthesia_kind && r.anesthesia_kind !== "none" ? [{ tone: "muted" as const, text: L.lbl(L.ANESTHESIA_KIND, s(r, "anesthesia_kind"), lang) }] : [])],
    fields: [
      f("kind", "نوع الزيارة", "Visit type", "select", { options: L.ENCOUNTER_KIND, dflt: "clinic" }),
      f("status", "الحالة", "Status", "select", { options: L.ENCOUNTER_STATUS, dflt: "completed" }),
      f("started_at", "بداية الزيارة", "Start", "datetime", { required: true }),
      f("ended_at", "نهاية الزيارة", "End", "datetime", { blank: true }),
      spec,
      f("facility_name", "المنشأة الصحية", "Facility", "text"),
      f("practitioner_name", "الطبيب / مقدم الرعاية", "Practitioner", "text"),
      f("reason", "سبب الزيارة", "Reason for visit", "text", { wide: true }),
      f("symptoms", "الأعراض", "Symptoms", "textarea", { wide: true }),
      f("history_of_present_illness", "التاريخ المرضي المرتبط", "History of present illness", "textarea", { wide: true }),
      f("examination", "الفحص السريري", "Clinical examination", "textarea", { wide: true }),
      f("assessment", "التقييم", "Assessment", "textarea", { wide: true }),
      f("plan", "الخطة", "Plan", "textarea", { wide: true }),
      // what was done in the chair (dental visits)
      teethField(),
      f("anesthesia_kind", "التخدير", "Anaesthesia", "select", { options: L.ANESTHESIA_KIND, only: "dental" }),
      f("anesthetic", "المادة المخدرة والكمية", "Anaesthetic and amount", "text", { only: "dental", maxLength: 300,
        hint: ["مثل: أرتيكائين 4% مع أدرينالين 1:100,000 — أمبولتان", "e.g. Articaine 4% with adrenaline 1:100,000 — 2 cartridges"] }),
      f("materials", "المواد المستخدمة", "Materials used", "text", { only: "dental", maxLength: 1000, wide: true }),
      f("complications", "المضاعفات", "Complications", "textarea", { wide: true }),
      f("instructions", "التعليمات المعطاة", "Instructions given", "textarea", { wide: true }),
      f("follow_up_date", "موعد المتابعة", "Follow-up date", "date"),
      f("summary", "ملخص الزيارة", "Visit summary", "textarea", { wide: true }),
      f("discharge_summary", "ملخص الخروج (للتنويم)", "Discharge summary (inpatient)", "textarea", { wide: true }),
    ],
  },
  procedures: {
    slug: "procedures", table: "procedures", ar: "العمليات والإجراءات", en: "Surgeries & procedures", singular: { ar: "إجراء", en: "procedure" },
    order: ["performed_on", "desc"], hasSpecialty: true, dateOf: (r) => (r.performed_on as string) ?? null, datePrecision: PREC, bodyField: "notes", links: ["encounter_id"],
    titleOf: (r) => s(r, "name"), dupKey: (r) => `${n(r, "name")}|${day(r.performed_on)}`,
    chipsOf: (r, lang) => [{ tone: "info", text: L.lbl(L.PROCEDURE_KIND, s(r, "kind"), lang) }, ...(r.body_site ? [{ tone: "muted" as const, text: s(r, "body_site") }] : []), ...teethChip(r, lang)],
    fields: [
      f("kind", "النوع", "Type", "select", { options: L.PROCEDURE_KIND, dflt: "procedure" }),
      f("name", "اسم الإجراء", "Procedure", "text", { required: true, wide: true }),
      f("performed_on", "تاريخ الإجراء", "Date", "date", { precision: PREC, hint: unknownDate }),
      teethField(),
      f("body_site", "الموضع (العضو)", "Body site", "text"),
      spec,
      f("facility_name", "المنشأة", "Facility", "text"),
      f("operator_name", "الجراح / المنفذ", "Surgeon / operator", "text"),
      f("anesthesia", "التخدير", "Anesthesia", "text"),
      f("indication", "الدافع", "Indication", "text", { wide: true }),
      f("outcome", "النتيجة", "Outcome", "textarea", { wide: true }),
      f("complications", "المضاعفات", "Complications", "textarea", { wide: true }),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  imaging: {
    slug: "imaging", table: "imaging_studies", ar: "الأشعة والتصوير", en: "Imaging", singular: { ar: "فحص تصوير", en: "imaging study" },
    order: ["performed_on", "desc"], hasSpecialty: true, dateOf: (r) => (r.performed_on as string) ?? null, datePrecision: PREC, bodyField: "impression",
    dupKey: (r) => `${s(r, "modality")}|${n(r, "body_site")}|${day(r.performed_on)}`,
    titleOf: (r, lang) => [L.lbl(L.IMAGING_MODALITY, s(r, "modality"), lang), s(r, "body_site")].filter(Boolean).join(" — "),
    chipsOf: (r, lang) => [
      ...(isWholeMouth(s(r, "modality"), r.teeth as number[] | null) ? [{ tone: "info" as const, text: lang === "ar" ? "كامل الفم" : "Whole mouth" }] : []),
      ...teethChip(r, lang),
      ...(r.bone_levels ? [{ tone: "muted" as const, text: `${lang === "ar" ? "فقد العظم" : "Bone"}: ${summarizeBoneLevels(r.bone_levels as BoneLevels, lang)}` }] : []),
      ...(r.test_order_id ? [{ tone: "ok" as const, text: lang === "ar" ? "لتلبية طلب" : "Fulfils a request" }] : []),
    ],
    fields: [
      f("modality", "نوع الفحص", "Modality", "select", { options: L.IMAGING_MODALITY, dflt: "xray" }),
      f("body_site", "المنطقة", "Body site", "text"),
      teethField(),
      f("performed_on", "تاريخ الفحص", "Date", "date", { precision: PREC, hint: unknownDate }),
      f("test_order_id", "يلبّي طلب التصوير", "Fulfils the imaging request", "imaging_order",
        { wide: true, hint: ["اختر الطلب المفتوح الذي أُجريت هذه الصورة من أجله؛ يُغلق الطلب تلقائياً.", "Choose the open request this image was taken for; it is closed automatically."] }),
      spec,
      f("facility_name", "المنشأة", "Facility", "text"),
      f("radiologist_name", "طبيب الأشعة", "Radiologist", "text"),
      f("findings", "الموجودات", "Findings", "textarea", { wide: true }),
      f("impression", "الانطباع / الخلاصة", "Impression", "textarea", { wide: true }),
      f("bone_levels", "قراءة مستوى العظم (لكل سدس)", "Bone level reading (per sextant)", "bonelevels", { wide: true, only: "dental",
        hint: ["اتركها فارغة إن لم تُقرأ الصورة لمستوى العظم.", "Leave empty if the bone level was not read on this image."] }),
    ],
  },
  immunizations: {
    slug: "immunizations", table: "immunizations", ar: "التطعيمات", en: "Immunizations", singular: { ar: "تطعيم", en: "immunization" },
    order: ["administered_on", "desc"], hasSpecialty: false, dateOf: (r) => (r.administered_on as string) ?? null, datePrecision: PREC, bodyField: "notes",
    dupKey: (r) => `${n(r, "vaccine_name")}|${s(r, "dose_number")}|${day(r.administered_on)}`,
    titleOf: (r) => s(r, "vaccine_name") + (r.dose_number ? ` #${s(r, "dose_number")}` : ""),
    chipsOf: (r, lang) => [{ tone: tone(s(r, "status"), { completed: "ok", scheduled: "info", contraindicated: "warn" }), text: L.lbl(L.IMMUNIZATION_STATUS, s(r, "status"), lang) }],
    fields: [
      f("vaccine_name", "اسم اللقاح", "Vaccine", "text", { required: true, wide: true }),
      f("dose_number", "رقم الجرعة", "Dose number", "number", { min: 1, max: 20, step: "1" }),
      f("status", "الحالة", "Status", "select", { options: L.IMMUNIZATION_STATUS, dflt: "completed" }),
      f("administered_on", "تاريخ التطعيم", "Date given", "date", { precision: PREC, hint: partialDate }),
      f("next_due_on", "موعد الجرعة القادمة", "Next dose due", "date"),
      f("lot_number", "رقم التشغيلة", "Lot number", "text"),
      f("facility_name", "المنشأة", "Facility", "text"),
      f("administered_by", "من أعطاه", "Given by", "text"),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  "family-history": {
    slug: "family-history", table: "family_history", ar: "التاريخ العائلي", en: "Family history", singular: { ar: "بند عائلي", en: "family entry" },
    order: ["recorded_at", "desc"], hasSpecialty: true, bodyField: "notes",
    titleOf: (r, lang) => `${L.lbl(L.FAMILY_RELATION, s(r, "relation"), lang)}: ${s(r, "condition_name")}`,
    dupKey: (r) => `${s(r, "relation")}|${n(r, "condition_name")}`,
    chipsOf: (r, lang) => [{ tone: "muted", text: L.lbl(L.FAMILY_CERTAINTY, s(r, "certainty"), lang) }, ...(r.age_at_onset != null ? [{ tone: "muted" as const, text: `${lang === "ar" ? "بدأ بعمر" : "onset at"} ${s(r, "age_at_onset")}` }] : [])],
    fields: [
      f("relation", "القرابة", "Relative", "select", { options: L.FAMILY_RELATION, required: true }),
      f("condition_name", "المرض", "Condition", "text", { required: true, wide: true }),
      f("age_at_onset", "العمر عند الإصابة", "Age at onset", "number", { min: 0, max: 130, step: "1" }),
      f("deceased", "متوفى", "Deceased", "checkbox"),
      f("certainty", "درجة التأكد", "Certainty", "select", { options: L.FAMILY_CERTAINTY, dflt: "reported" }),
      spec,
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  appointments: {
    slug: "appointments", table: "appointments", ar: "المواعيد", en: "Appointments", singular: { ar: "موعد", en: "appointment" },
    order: ["scheduled_at", "desc"], hasSpecialty: true, dateOf: (r) => (r.scheduled_at as string) ?? null, dateKind: "datetime", bodyField: "notes",
    titleOf: (r) => [s(r, "reason"), s(r, "practitioner_name")].filter(Boolean).join(" — ") || "—",
    dupKey: (r) => `${minute(r.scheduled_at)}|${n(r, "practitioner_name")}`,
    chipsOf: (r, lang) => [{ tone: tone(s(r, "status"), { scheduled: "info", completed: "ok", no_show: "warn" }), text: L.lbl(L.APPOINTMENT_STATUS, s(r, "status"), lang) }],
    fields: [
      f("scheduled_at", "موعد الحضور", "Scheduled for", "datetime", { required: true }),
      f("status", "الحالة", "Status", "select", { options: L.APPOINTMENT_STATUS, dflt: "scheduled" }),
      spec,
      f("facility_name", "المنشأة", "Facility", "text"),
      f("practitioner_name", "الطبيب", "Practitioner", "text"),
      f("reason", "سبب الموعد", "Reason", "text", { wide: true }),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  "care-plans": {
    slug: "care-plans", table: "care_plans", ar: "خطط العلاج والمتابعة", en: "Care & follow-up plans", singular: { ar: "خطة", en: "plan" },
    order: ["start_date", "desc"], hasSpecialty: true, dateOf: (r) => (r.start_date as string) ?? null, bodyField: "goals", links: ["encounter_id", "condition_id"],
    titleOf: (r) => s(r, "title"), dupKey: (r) => n(r, "title"),
    chipsOf: (r, lang) => [{ tone: tone(s(r, "status"), { active: "ok", draft: "muted" }), text: L.lbl(L.CARE_PLAN_STATUS, s(r, "status"), lang) }],
    fields: [
      f("title", "عنوان الخطة", "Plan title", "text", { required: true, wide: true }),
      f("status", "الحالة", "Status", "select", { options: L.CARE_PLAN_STATUS, dflt: "active" }),
      f("start_date", "البداية", "Start", "date"),
      f("end_date", "النهاية", "End", "date"),
      spec,
      f("goals", "الأهداف", "Goals", "textarea", { wide: true }),
      f("instructions", "التعليمات", "Instructions", "textarea", { wide: true }),
    ],
  },
  notes: {
    slug: "notes", table: "clinical_notes", ar: "الملاحظات السريرية", en: "Clinical notes", singular: { ar: "ملاحظة", en: "note" },
    order: ["noted_at", "desc"], hasSpecialty: true, dateOf: (r) => (r.noted_at as string) ?? null, dateKind: "datetime", bodyField: "body",
    titleOf: (r, lang) => s(r, "title") || L.lbl(L.NOTE_KIND, s(r, "kind"), lang),
    dupKey: (r) => `${n(r, "title")}|${normText(r.body).slice(0, 200)}`,
    chipsOf: (r, lang) => [{ tone: "muted", text: L.lbl(L.NOTE_KIND, s(r, "kind"), lang) },
      { tone: r.status === "signed" ? "ok" : "warn", text: L.lbl(L.NOTE_STATUS, s(r, "status") || "draft", lang) }],
    fields: [
      f("kind", "النوع", "Type", "select", { options: L.NOTE_KIND, dflt: "patient_note" }),
      f("title", "العنوان", "Title", "text", { wide: true }),
      f("noted_at", "وقت الملاحظة", "Noted at", "datetime", { required: true }),
      spec,
      f("author_name", "كاتب الملاحظة", "Author", "text"),
      f("body", "النص", "Text", "textarea", { required: true, wide: true, rows: 5 }),
    ],
  },
  "test-orders": {
    slug: "test-orders", table: "test_orders", ar: "الفحوصات المطلوبة", en: "Requested tests", singular: { ar: "فحص مطلوب", en: "test request" },
    order: ["requested_on", "desc"], hasSpecialty: true, dateOf: (r) => (r.requested_on as string) ?? null, bodyField: "reason",
    titleOf: (r) => s(r, "name"),
    // only open requests are compared: asking for the same test again after it was done is normal
    dupKey: (r) => (r.status === "suggested" || r.status === "requested" ? n(r, "name") : null),
    chipsOf: (r, lang) => [
      { tone: tone(s(r, "status"), { done: "ok", requested: "info", suggested: "muted" }), text: L.lbl(L.ORDER_STATUS, s(r, "status"), lang) },
      { tone: tone(s(r, "priority"), { urgent: "bad", soon: "warn" }), text: L.lbl(L.ORDER_PRIORITY, s(r, "priority"), lang) },
      { tone: "muted", text: L.lbl(L.ORDER_KIND, s(r, "kind"), lang) },
    ],
    fields: [
      f("name", "اسم الفحص", "Test", "text", { required: true, wide: true }),
      f("kind", "النوع", "Type", "select", { options: L.ORDER_KIND, dflt: "lab" }),
      f("priority", "الأولوية", "Priority", "select", { options: L.ORDER_PRIORITY, dflt: "routine" }),
      f("status", "الحالة", "Status", "select", { options: L.ORDER_STATUS, dflt: "requested", hint: ["«مقترح» إن اقترحه تقرير أو المريض ولم يطلبه طبيب بعد.", "“Suggested” when a report or the patient proposed it and no clinician has ordered it yet."] }),
      f("ordered_by", "الطبيب الطالب", "Ordered by", "text", { maxLength: 200 }),
      f("requested_on", "تاريخ الطلب / الاقتراح", "Requested / suggested on", "date", { required: true, dflt: "today" }),
      f("done_on", "تاريخ الإنجاز", "Done on", "date"),
      spec,
      f("reason", "سبب الطلب", "Reason", "textarea", { wide: true }),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  devices: {
    slug: "devices", table: "patient_devices", ar: "الأجهزة والزرعات", en: "Devices & implants", singular: { ar: "جهاز أو زرعة", en: "device or implant" },
    order: ["implanted_on", "desc"], hasSpecialty: true, bodyField: "notes", dateOf: (r) => (r.implanted_on as string) ?? null, datePrecision: PREC,
    dupKey: (r) => `${s(r, "kind")}|${n(r, "name")}|${n(r, "body_site")}`,
    titleOf: (r, lang) => [L.lbl(L.DEVICE_KIND, s(r, "kind"), lang), s(r, "name")].filter(Boolean).join(" — "),
    chipsOf: (r, lang) => [
      { tone: s(r, "status") === "in_place" ? "info" : "muted", text: L.lbl(L.DEVICE_STATUS, s(r, "status"), lang) },
      ...(r.mri_safety && r.mri_safety !== "unknown" ? [{ tone: (r.mri_safety === "unsafe" ? "bad" : r.mri_safety === "conditional" ? "warn" : "ok") as Chip["tone"], text: `MRI: ${L.lbl(L.MRI_SAFETY, s(r, "mri_safety"), lang)}` }] : []),
    ],
    fields: [
      f("kind", "النوع", "Kind", "select", { options: L.DEVICE_KIND, dflt: "other" }),
      f("name", "الوصف", "Description", "text", { maxLength: 200, hint: ["مثال: صمام أبهري ميكانيكي، مفصل ورك أيمن.", "e.g. mechanical aortic valve, right hip replacement."] }),
      f("body_site", "الموضع", "Body site", "text", { maxLength: 200 }),
      f("implanted_on", "تاريخ الزرع", "Implanted on", "date", { precision: PREC, hint: partialDate }),
      f("status", "الحالة", "Status", "select", { options: L.DEVICE_STATUS, dflt: "in_place" }),
      f("removed_on", "تاريخ الإزالة", "Removed on", "date"),
      f("mri_safety", "الأمان في الرنين المغناطيسي", "MRI safety", "select", { options: L.MRI_SAFETY, dflt: "unknown" }),
      f("manufacturer", "الشركة / الطراز", "Manufacturer / model", "text", { maxLength: 200 }),
      spec,
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  symptoms: {
    slug: "symptoms", table: "symptom_entries", ar: "سجل الأعراض", en: "Symptom log", singular: { ar: "عرض", en: "symptom" },
    order: ["onset_at", "desc"], hasSpecialty: true, bodyField: "notes", dateOf: (r) => (r.onset_at as string) ?? null, dateKind: "datetime",
    titleOf: (r) => [s(r, "symptom"), s(r, "body_site")].filter(Boolean).join(" — "),
    chipsOf: (r, lang) => [
      ...(r.severity != null ? [{ tone: (Number(r.severity) >= 7 ? "bad" : Number(r.severity) >= 4 ? "warn" : "muted") as Chip["tone"], text: `${lang === "ar" ? "الشدة" : "Severity"} ${s(r, "severity")}/10` }] : []),
      ...(r.pattern ? [{ tone: "muted" as const, text: L.lbl(L.SYMPTOM_PATTERN, s(r, "pattern"), lang) }] : []),
      { tone: r.ended_at ? "ok" : "info", text: r.ended_at ? (lang === "ar" ? "انتهى" : "Ended") : (lang === "ar" ? "مستمر" : "Ongoing") },
    ],
    fields: [
      f("symptom", "العرض", "Symptom", "text", { required: true, maxLength: 200, wide: true, hint: ["مثال: صداع، سعال، ألم في الصدر، دوخة.", "e.g. headache, cough, chest pain, dizziness."] }),
      f("severity", "الشدة (0 لا شيء – 10 الأشد)", "Severity (0 none – 10 worst)", "number", { min: 0, max: 10, step: "1" }),
      f("onset_at", "بدأ في", "Started", "datetime", { required: true }),
      f("ended_at", "انتهى في", "Ended", "datetime", { blank: true, hint: ["اتركه فارغاً إن كان العرض مستمراً.", "Leave empty while it is still going on."] }),
      f("body_site", "الموضع", "Body site", "text", { maxLength: 200 }),
      f("pattern", "النمط", "Pattern", "select", { options: L.SYMPTOM_PATTERN }),
      f("triggers", "ما يثيره", "Triggers", "text", { maxLength: 1000, wide: true }),
      f("relieved_by", "ما يخففه", "Relieved by", "text", { maxLength: 1000, wide: true }),
      f("condition_id", "مرتبط بمرض مسجل", "Linked condition", "link"),
      spec,
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  exposures: {
    slug: "exposures", table: "patient_exposures", ar: "التعرضات المهنية والبيئية", en: "Occupational & environmental exposures", singular: { ar: "تعرّض", en: "exposure" },
    order: ["recorded_at", "desc"], hasSpecialty: false, bodyField: "notes", dateOf: (r) => (r.recorded_at as string) ?? null, dateKind: "datetime",
    dupKey: (r) => `${s(r, "kind")}|${n(r, "agent")}|${s(r, "setting")}`,
    titleOf: (r, lang) => [L.lbl(L.EXPOSURE_KIND, s(r, "kind"), lang), s(r, "agent")].filter(Boolean).join(" — "),
    chipsOf: (r, lang) => [
      { tone: "muted", text: L.lbl(L.EXPOSURE_SETTING, s(r, "setting"), lang) },
      ...(r.years != null ? [{ tone: "muted" as const, text: lang === "ar" ? `${s(r, "years")} سنة` : `${s(r, "years")} y` }] : []),
      { tone: r.ongoing ? "info" : "muted", text: r.ongoing ? (lang === "ar" ? "مستمر" : "Ongoing") : (lang === "ar" ? "انتهى" : "Past") },
      { tone: (r.protective_equipment === "always" ? "ok" : r.protective_equipment === "none" ? "warn" : "muted") as Chip["tone"], text: `${lang === "ar" ? "الوقاية" : "Protection"}: ${L.lbl(L.PROTECTIVE_EQUIPMENT, s(r, "protective_equipment"), lang)}` },
    ],
    fields: [
      f("kind", "نوع التعرض", "Kind", "select", { options: L.EXPOSURE_KIND, dflt: "other" }),
      f("agent", "المادة أو المصدر", "Agent / source", "text", { maxLength: 200, wide: true, hint: ["مثال: غبار خشب، دهانات، أشعة سينية في المستشفى.", "e.g. wood dust, paints, X-rays at the hospital."] }),
      f("setting", "أين", "Where", "select", { options: L.EXPOSURE_SETTING, dflt: "work" }),
      f("years", "عدد السنوات", "Years exposed", "number", { min: 0, max: 80, step: "0.5" }),
      f("ongoing", "ما زال مستمراً", "Still ongoing", "checkbox", { dflt: true }),
      f("protective_equipment", "معدات الوقاية", "Protective equipment", "select", { options: L.PROTECTIVE_EQUIPMENT, dflt: "unknown" }),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  // invalidation only: the payload of these records is rendered/edited by the specialty page
  "specialty-records": {
    slug: "specialty-records", table: "specialty_records", ar: "سجلات التخصص", en: "Specialty records", singular: { ar: "سجل", en: "record" },
    order: ["occurred_on", "desc"], hasSpecialty: true, titleOf: (r) => s(r, "id"), fields: [],
  },
};

// Selects that map to NOT NULL columns must always carry a value: no empty choice is offered.
const NOT_NULL_SELECTS: Record<string, string[]> = {
  conditions: ["category", "clinical_status", "certainty"],
  allergies: ["category", "severity", "status", "certainty"],
  medications: ["origin", "status"],
  visits: ["kind", "status"],
  procedures: ["kind"],
  imaging: ["modality"],
  immunizations: ["status"],
  "family-history": ["certainty"],
  appointments: ["status"],
  "care-plans": ["status"],
  notes: ["kind"],
  "test-orders": ["kind", "priority", "status"],
  devices: ["kind", "status", "mri_safety"],
  exposures: ["kind", "setting", "protective_equipment"],
};
for (const [slug, names] of Object.entries(NOT_NULL_SELECTS)) {
  for (const fld of ENTITIES[slug].fields) if (names.includes(fld.name)) fld.required = true;
}

/** Slugs served by the generic /patients/[pid]/[slug] page (visits has its own route for the detail view). */
export const GENERIC_SLUGS = Object.keys(ENTITIES).filter((k) => !["visits", "specialty-records", "symptoms", "exposures"].includes(k));
