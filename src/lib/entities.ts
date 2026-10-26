import * as L from "@/lib/labels";
import type { Opt } from "@/lib/labels";
import type { Lang } from "@/lib/i18n";
import type { Row } from "@/lib/types";

export type FieldKind = "text" | "textarea" | "date" | "datetime" | "number" | "select" | "checkbox" | "specialty";

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
}

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
}

const s = (r: Row, k: string) => (r[k] == null ? "" : String(r[k]));
const f = (name: string, ar: string, en: string, kind: FieldKind, extra: Partial<FieldDef> = {}): FieldDef => ({ name, ar, en, kind, ...extra });
const spec = f("specialty_id", "التخصص", "Specialty", "specialty", { hint: ["اربط السجل بقسم طبي ليظهر في ملفه وتشمله مشاركته.", "Link to a specialty so it appears in that file and in its shares."] });

const tone = (v: string, map: Record<string, Chip["tone"]>): Chip["tone"] => map[v] ?? "muted";

export const ENTITIES: Record<string, EntityDef> = {
  conditions: {
    slug: "conditions", table: "conditions", ar: "الأمراض والتشخيصات", en: "Conditions & diagnoses", singular: { ar: "حالة", en: "condition" },
    order: ["onset_date", "desc"], hasSpecialty: true, bodyField: "notes", dateOf: (r) => (r.onset_date as string) ?? null, links: ["encounter_id"],
    titleOf: (r) => s(r, "name"),
    chipsOf: (r, lang) => [
      { tone: r.category === "chronic" || r.category === "congenital" ? "info" : "muted", text: L.lbl(L.CONDITION_CATEGORY, s(r, "category"), lang) },
      { tone: tone(s(r, "clinical_status"), { active: "warn", recurrence: "warn", resolved: "ok", remission: "ok" }), text: L.lbl(L.CLINICAL_STATUS, s(r, "clinical_status"), lang) },
      { tone: s(r, "certainty") === "confirmed" ? "ok" : "muted", text: L.lbl(L.CERTAINTY, s(r, "certainty"), lang) },
      ...(r.severity ? [{ tone: "muted" as const, text: L.lbl(L.SEVERITY3, s(r, "severity"), lang) }] : []),
      ...(r.sensitive ? [{ tone: "warn" as const, text: lang === "ar" ? "حساس" : "Sensitive" }] : []),
    ],
    fields: [
      f("name", "اسم المرض / التشخيص", "Condition / diagnosis", "text", { required: true, maxLength: 200, wide: true }),
      f("category", "التصنيف", "Category", "select", { options: L.CONDITION_CATEGORY, dflt: "chronic" }),
      f("clinical_status", "الحالة الآن", "Current status", "select", { options: L.CLINICAL_STATUS, dflt: "active" }),
      f("certainty", "درجة التأكد", "Certainty", "select", { options: L.CERTAINTY, dflt: "unknown", hint: ["«مؤكد» فقط إن أكده مقدم رعاية. اتركه «غير معروف» عند الشك.", "Use “Confirmed” only when a care provider confirmed it."] }),
      f("severity", "الشدة", "Severity", "select", { options: L.SEVERITY3 }),
      f("onset_date", "تاريخ البداية", "Onset date", "date"),
      f("resolved_date", "تاريخ الشفاء / الانتهاء", "Resolved date", "date"),
      f("icd10_code", "رمز ICD-10 (اختياري)", "ICD-10 code (optional)", "text", { maxLength: 12 }),
      spec,
      f("sensitive", "حالة حساسة (لا تُشارك إلا بإذن صريح)", "Sensitive (shared only when explicitly allowed)", "checkbox"),
      f("notes", "ملاحظات", "Notes", "textarea", { wide: true }),
    ],
  },
  allergies: {
    slug: "allergies", table: "allergies", ar: "الحساسية", en: "Allergies", singular: { ar: "حساسية", en: "allergy" },
    order: ["recorded_at", "desc"], hasSpecialty: true, bodyField: "notes", dateOf: (r) => (r.onset_date as string) ?? null,
    titleOf: (r) => s(r, "substance"),
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
    order: ["start_date", "desc"], hasSpecialty: true, bodyField: "instructions", dateOf: (r) => (r.start_date as string) ?? null, links: ["encounter_id", "condition_id"],
    titleOf: (r) => [s(r, "name_generic"), s(r, "name_brand") && `(${s(r, "name_brand")})`, s(r, "strength")].filter(Boolean).join(" "),
    chipsOf: (r, lang) => [
      { tone: tone(s(r, "status"), { active: "ok", on_hold: "warn" }), text: L.lbl(L.MED_STATUS, s(r, "status"), lang) },
      { tone: "info", text: L.lbl(L.MED_ORIGIN, s(r, "origin"), lang) },
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
      f("as_needed", "عند الحاجة فقط", "Only when needed", "checkbox"),
      f("origin", "مصدر المعلومة", "How we know", "select", { options: L.MED_ORIGIN, dflt: "patient_reported" }),
      f("status", "الحالة", "Status", "select", { options: L.MED_STATUS, dflt: "active", hint: ["لا تُعد الأدوية القديمة فعّالة: غيّر الحالة عند إيقافها.", "Old medications are not assumed active — change the status when stopped."] }),
      f("start_date", "تاريخ البدء", "Start date", "date"),
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
    chipsOf: (r, lang) => [{ tone: tone(s(r, "status"), { completed: "ok", planned: "info", in_progress: "warn" }), text: L.lbl(L.ENCOUNTER_STATUS, s(r, "status"), lang) }],
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
      f("plan", "خطة العلاج", "Treatment plan", "textarea", { wide: true }),
      f("follow_up_date", "موعد المتابعة", "Follow-up date", "date"),
      f("summary", "ملخص الزيارة", "Visit summary", "textarea", { wide: true }),
      f("discharge_summary", "ملخص الخروج (للتنويم)", "Discharge summary (inpatient)", "textarea", { wide: true }),
    ],
  },
  procedures: {
    slug: "procedures", table: "procedures", ar: "العمليات والإجراءات", en: "Surgeries & procedures", singular: { ar: "إجراء", en: "procedure" },
    order: ["performed_on", "desc"], hasSpecialty: true, dateOf: (r) => (r.performed_on as string) ?? null, bodyField: "notes", links: ["encounter_id"],
    titleOf: (r) => s(r, "name"),
    chipsOf: (r, lang) => [{ tone: "info", text: L.lbl(L.PROCEDURE_KIND, s(r, "kind"), lang) }, ...(r.body_site ? [{ tone: "muted" as const, text: s(r, "body_site") }] : [])],
    fields: [
      f("kind", "النوع", "Type", "select", { options: L.PROCEDURE_KIND, dflt: "procedure" }),
      f("name", "اسم الإجراء", "Procedure", "text", { required: true, wide: true }),
      f("performed_on", "تاريخ الإجراء", "Date", "date", { required: true }),
      f("body_site", "الموضع (عضو / رقم السن)", "Site (organ / tooth no.)", "text"),
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
    order: ["performed_on", "desc"], hasSpecialty: true, dateOf: (r) => (r.performed_on as string) ?? null, bodyField: "impression",
    titleOf: (r, lang) => [L.lbl(L.IMAGING_MODALITY, s(r, "modality"), lang), s(r, "body_site")].filter(Boolean).join(" — "),
    fields: [
      f("modality", "نوع الفحص", "Modality", "select", { options: L.IMAGING_MODALITY, dflt: "xray" }),
      f("body_site", "المنطقة", "Body site", "text"),
      f("performed_on", "تاريخ الفحص", "Date", "date", { required: true }),
      spec,
      f("facility_name", "المنشأة", "Facility", "text"),
      f("radiologist_name", "طبيب الأشعة", "Radiologist", "text"),
      f("findings", "الموجودات", "Findings", "textarea", { wide: true }),
      f("impression", "الانطباع / الخلاصة", "Impression", "textarea", { wide: true }),
    ],
  },
  immunizations: {
    slug: "immunizations", table: "immunizations", ar: "التطعيمات", en: "Immunizations", singular: { ar: "تطعيم", en: "immunization" },
    order: ["administered_on", "desc"], hasSpecialty: false, dateOf: (r) => (r.administered_on as string) ?? null, bodyField: "notes",
    titleOf: (r) => s(r, "vaccine_name") + (r.dose_number ? ` #${s(r, "dose_number")}` : ""),
    chipsOf: (r, lang) => [{ tone: tone(s(r, "status"), { completed: "ok", scheduled: "info", contraindicated: "warn" }), text: L.lbl(L.IMMUNIZATION_STATUS, s(r, "status"), lang) }],
    fields: [
      f("vaccine_name", "اسم اللقاح", "Vaccine", "text", { required: true, wide: true }),
      f("dose_number", "رقم الجرعة", "Dose number", "number", { min: 1, max: 20, step: "1" }),
      f("status", "الحالة", "Status", "select", { options: L.IMMUNIZATION_STATUS, dflt: "completed" }),
      f("administered_on", "تاريخ التطعيم", "Date given", "date"),
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
    titleOf: (r) => s(r, "title"),
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
    chipsOf: (r, lang) => [{ tone: "muted", text: L.lbl(L.NOTE_KIND, s(r, "kind"), lang) }],
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
    chipsOf: (r, lang) => [
      { tone: tone(s(r, "status"), { done: "ok", requested: "info" }), text: L.lbl(L.ORDER_STATUS, s(r, "status"), lang) },
      { tone: tone(s(r, "priority"), { urgent: "bad", soon: "warn" }), text: L.lbl(L.ORDER_PRIORITY, s(r, "priority"), lang) },
      { tone: "muted", text: L.lbl(L.ORDER_KIND, s(r, "kind"), lang) },
    ],
    fields: [
      f("name", "اسم الفحص", "Test", "text", { required: true, wide: true }),
      f("kind", "النوع", "Type", "select", { options: L.ORDER_KIND, dflt: "lab" }),
      f("priority", "الأولوية", "Priority", "select", { options: L.ORDER_PRIORITY, dflt: "routine" }),
      f("status", "الحالة", "Status", "select", { options: L.ORDER_STATUS, dflt: "requested" }),
      f("requested_on", "تاريخ الطلب", "Requested on", "date"),
      f("done_on", "تاريخ الإنجاز", "Done on", "date"),
      spec,
      f("reason", "سبب الطلب", "Reason", "textarea", { wide: true }),
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
};
for (const [slug, names] of Object.entries(NOT_NULL_SELECTS)) {
  for (const fld of ENTITIES[slug].fields) if (names.includes(fld.name)) fld.required = true;
}

/** Slugs served by the generic /patients/[pid]/[slug] page (visits has its own route for the detail view). */
export const GENERIC_SLUGS = Object.keys(ENTITIES).filter((k) => k !== "visits" && k !== "specialty-records");
