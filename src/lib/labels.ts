import type { Lang } from "@/lib/i18n";

export type Opt = { value: string; ar: string; en: string };
const o = (value: string, ar: string, en: string): Opt => ({ value, ar, en });

export const SEX: Opt[] = [o("male", "ذكر", "Male"), o("female", "أنثى", "Female"), o("intersex", "ثنائي الجنس", "Intersex"), o("unspecified", "غير محدد", "Unspecified")];
export const ABO: Opt[] = ["A", "B", "AB", "O"].map((v) => o(v, v, v));
export const RH: Opt[] = [o("+", "موجب (+)", "Positive (+)"), o("-", "سالب (−)", "Negative (−)")];
export const ALLERGY_ASSERTION: Opt[] = [
  o("unknown", "غير معروف / لم يُتحقق منه", "Unknown / not yet checked"),
  o("none_known", "لا توجد حساسية معروفة", "No known allergies"),
  o("has_allergies", "توجد حساسية موثقة", "Has documented allergies"),
];

export const SOURCE: Opt[] = [
  o("self", "أدخلته أنا / المريض", "Entered by patient / caregiver"), o("clinic", "عيادة", "Clinic"), o("hospital", "مستشفى", "Hospital"),
  o("laboratory", "مختبر", "Laboratory"), o("device", "جهاز قياس", "Measuring device"), o("imported", "مستورد", "Imported"), o("other", "أخرى", "Other"),
];
export const VERIFICATION: Opt[] = [
  o("reported", "أدخله المريض (غير موثق)", "Patient-reported (unverified)"),
  o("confirmed", "مؤكد من مقدم رعاية", "Confirmed by a care provider"),
  o("verified", "موثق من مصدر معتمد", "Verified from an authoritative source"),
];

export const CONDITION_CATEGORY: Opt[] = [
  o("chronic", "مرض مزمن", "Chronic condition"), o("congenital", "عيب خلقي", "Congenital condition"), o("genetic", "حالة وراثية", "Genetic condition"),
  o("diagnosis", "تشخيص", "Diagnosis"), o("acute", "حالة حادة", "Acute condition"), o("mental_health", "صحة نفسية", "Mental health"),
  o("disability", "إعاقة", "Disability"), o("other", "أخرى", "Other"),
];
export const CLINICAL_STATUS: Opt[] = [
  o("active", "نشطة", "Active"), o("recurrence", "انتكاسة", "Recurrence"), o("inactive", "غير نشطة", "Inactive"),
  o("remission", "هدأت", "In remission"), o("resolved", "شُفيت / منتهية", "Resolved"),
];
export const CERTAINTY: Opt[] = [
  o("confirmed", "مؤكد", "Confirmed"), o("suspected", "مشتبه به", "Suspected"), o("provisional", "مبدئي", "Provisional"),
  o("unknown", "غير معروف", "Unknown"), o("refuted", "نُفي", "Refuted"),
];
export const SEVERITY3: Opt[] = [o("mild", "خفيفة", "Mild"), o("moderate", "متوسطة", "Moderate"), o("severe", "شديدة", "Severe")];
export const ALLERGY_CATEGORY: Opt[] = [
  o("medication", "دواء", "Medication"), o("food", "غذاء", "Food"), o("environment", "بيئة", "Environmental"),
  o("biologic", "منتج حيوي / لقاح", "Biologic / vaccine"), o("latex", "لاتكس", "Latex"), o("other", "أخرى", "Other"),
];
export const ALLERGY_SEVERITY: Opt[] = [
  o("unknown", "غير معروفة", "Unknown"), o("mild", "خفيفة", "Mild"), o("moderate", "متوسطة", "Moderate"),
  o("severe", "شديدة", "Severe"), o("life_threatening", "مهددة للحياة", "Life-threatening"),
];
export const ALLERGY_STATUS: Opt[] = [o("active", "نشطة", "Active"), o("inactive", "غير نشطة", "Inactive"), o("resolved", "زالت", "Resolved")];
export const ALLERGY_CERTAINTY: Opt[] = [o("unverified", "غير موثقة", "Unverified"), o("confirmed", "موثقة", "Confirmed"), o("refuted", "نُفيت", "Refuted")];

export const MED_ORIGIN: Opt[] = [
  o("prescribed", "موصوف من طبيب", "Prescribed"), o("patient_reported", "يذكر المريض أنه يتناوله", "Patient-reported"), o("otc_supplement", "بدون وصفة / مكمل", "Over-the-counter / supplement"),
];
export const MED_STATUS: Opt[] = [o("active", "يُستخدم حالياً", "Currently taking"), o("on_hold", "موقوف مؤقتاً", "On hold"), o("stopped", "أُوقف", "Stopped"), o("completed", "انتهت الكورة", "Course completed")];
export const MED_STOPPED_BY: Opt[] = [
  o("clinician", "أوقفه الطبيب", "Stopped by clinician"), o("patient", "أوقفه المريض", "Stopped by patient"), o("course_completed", "انتهت مدة العلاج", "Course completed"),
  o("adverse_reaction", "بسبب أثر جانبي", "Adverse reaction"), o("other", "سبب آخر", "Other"),
];
export const MED_FORM: Opt[] = ["tablet:أقراص:Tablet", "capsule:كبسولات:Capsule", "syrup:شراب:Syrup", "injection:حقن:Injection", "cream:كريم / مرهم:Cream / ointment", "drops:قطرة:Drops", "inhaler:بخاخ:Inhaler", "patch:لصقة:Patch", "other:أخرى:Other"]
  .map((s) => { const [v, a, e] = s.split(":"); return o(v, a, e); });
export const MED_ROUTE: Opt[] = ["oral:فموي:Oral", "iv:وريدي:Intravenous", "im:عضلي:Intramuscular", "sc:تحت الجلد:Subcutaneous", "topical:موضعي:Topical", "inhaled:استنشاق:Inhaled", "ophthalmic:عين:Ophthalmic", "otic:أذن:Otic", "nasal:أنف:Nasal", "rectal:شرجي:Rectal", "sublingual:تحت اللسان:Sublingual", "other:أخرى:Other"]
  .map((s) => { const [v, a, e] = s.split(":"); return o(v, a, e); });

export const ENCOUNTER_KIND: Opt[] = [
  o("clinic", "زيارة عيادة", "Clinic visit"), o("emergency", "طوارئ", "Emergency"), o("telehealth", "استشارة عن بعد", "Telehealth"),
  o("inpatient", "تنويم", "Inpatient stay"), o("surgery", "عملية جراحية", "Surgery"), o("diagnostic", "إجراء تشخيصي", "Diagnostic procedure"),
  o("therapy_session", "جلسة علاج", "Therapy session"), o("follow_up", "زيارة متابعة", "Follow-up visit"), o("home_visit", "زيارة منزلية", "Home visit"), o("dental", "زيارة أسنان", "Dental visit"),
];
export const ENCOUNTER_STATUS: Opt[] = [o("planned", "مخططة", "Planned"), o("in_progress", "جارية", "In progress"), o("completed", "مكتملة", "Completed"), o("cancelled", "ملغاة", "Cancelled")];
export const PROCEDURE_KIND: Opt[] = [
  o("surgery", "عملية جراحية", "Surgery"), o("procedure", "إجراء طبي", "Procedure"), o("dental", "إجراء أسنان", "Dental procedure"),
  o("endoscopy", "منظار", "Endoscopy"), o("biopsy", "خزعة", "Biopsy"), o("therapy", "علاج", "Therapy"), o("other", "أخرى", "Other"),
];
export const IMAGING_MODALITY: Opt[] = [
  o("xray", "أشعة سينية", "X-ray"), o("dental_xray", "أشعة أسنان", "Dental X-ray"), o("panoramic", "بانوراما أسنان", "Panoramic"), o("ct", "أشعة مقطعية", "CT"),
  o("mri", "رنين مغناطيسي", "MRI"), o("ultrasound", "سونار", "Ultrasound"), o("echo", "إيكو القلب", "Echocardiography"), o("mammography", "ماموغرام", "Mammography"),
  o("fluoroscopy", "تنظير شعاعي", "Fluoroscopy"), o("nuclear", "طب نووي", "Nuclear medicine"), o("other", "أخرى", "Other"),
];
export const DOC_TYPE: Opt[] = [
  o("doctor_report", "تقرير طبيب", "Doctor's report"), o("lab_report", "نتيجة مختبر", "Lab report"), o("imaging_image", "صورة أشعة", "Imaging study"),
  o("imaging_report", "تقرير أشعة", "Imaging report"), o("dental_image", "صورة أسنان", "Dental image"), o("prescription", "وصفة طبية", "Prescription"),
  o("operative_report", "تقرير عملية", "Operative report"), o("discharge_summary", "تقرير خروج", "Discharge summary"), o("vaccination_record", "سجل تطعيمات", "Vaccination record"),
  o("external_record", "سجل خارجي", "External record"), o("insurance", "تأمين", "Insurance"), o("other", "أخرى", "Other"),
];
export const SENSITIVITY: Opt[] = [
  o("standard", "عادي", "Standard"), o("sensitive", "حساس", "Sensitive"), o("restricted", "مقيَّد (لا يُشارك إلا باختيار مباشر)", "Restricted (shared only when picked individually)"),
];
export const IMMUNIZATION_STATUS: Opt[] = [o("completed", "تم", "Given"), o("scheduled", "مجدول", "Scheduled"), o("declined", "رفض", "Declined"), o("contraindicated", "ممنوع طبياً", "Contraindicated")];
export const FAMILY_RELATION: Opt[] = ["father:الأب:Father", "mother:الأم:Mother", "brother:أخ:Brother", "sister:أخت:Sister", "son:ابن:Son", "daughter:ابنة:Daughter", "paternal_grandfather:الجد لأب:Paternal grandfather", "paternal_grandmother:الجدة لأب:Paternal grandmother", "maternal_grandfather:الجد لأم:Maternal grandfather", "maternal_grandmother:الجدة لأم:Maternal grandmother", "uncle:عم / خال:Uncle", "aunt:عمة / خالة:Aunt", "cousin:ابن / ابنة عم أو خال:Cousin", "other:قريب آخر:Other relative"]
  .map((s) => { const [v, a, e] = s.split(":"); return o(v, a, e); });
export const FAMILY_CERTAINTY: Opt[] = [o("reported", "أفاد به المريض", "Reported"), o("confirmed", "مؤكد", "Confirmed"), o("unknown", "غير معروف", "Unknown")];
export const APPOINTMENT_STATUS: Opt[] = [o("scheduled", "مجدول", "Scheduled"), o("completed", "تم", "Attended"), o("cancelled", "ملغى", "Cancelled"), o("no_show", "لم يحضر", "No-show")];
export const CARE_PLAN_STATUS: Opt[] = [o("draft", "مسودة", "Draft"), o("active", "نشطة", "Active"), o("on_hold", "موقوفة", "On hold"), o("completed", "مكتملة", "Completed"), o("cancelled", "ملغاة", "Cancelled")];
export const NOTE_KIND: Opt[] = [o("progress", "ملاحظة متابعة", "Progress note"), o("consult", "استشارة", "Consultation"), o("nursing", "تمريض", "Nursing"), o("patient_note", "ملاحظة المريض", "Patient note"), o("other", "أخرى", "Other")];
export const ORDER_KIND: Opt[] = [o("lab", "تحليل مخبري", "Lab test"), o("imaging", "تصوير", "Imaging"), o("clinical", "فحص سريري", "Clinical exam"), o("other", "أخرى", "Other")];
export const ORDER_PRIORITY: Opt[] = [o("routine", "عادي", "Routine"), o("soon", "قريباً", "Soon"), o("urgent", "عاجل", "Urgent")];
export const ORDER_STATUS: Opt[] = [o("requested", "مطلوب", "Requested"), o("done", "تم", "Done"), o("cancelled", "ملغى", "Cancelled")];
export const SETTING: Opt[] = [o("home", "المنزل", "Home"), o("clinic", "عيادة", "Clinic"), o("hospital", "مستشفى", "Hospital"), o("lab", "مختبر", "Laboratory"), o("other", "مكان آخر", "Other")];
export const LAB_STATUS: Opt[] = [o("final", "معتمدة", "Final"), o("preliminary", "أولية", "Preliminary")];
export const LAB_FLAG: Opt[] = [o("", "بدون علامة", "No flag"), o("normal", "طبيعي", "Normal"), o("low", "منخفض", "Low"), o("high", "مرتفع", "High"), o("critical_low", "منخفض جداً", "Critically low"), o("critical_high", "مرتفع جداً", "Critically high"), o("abnormal", "غير طبيعي", "Abnormal")];

/** Measurement conditions offered per observation type. */
export const CONTEXT_BY_TYPE: Record<string, Opt[]> = {
  blood_pressure: [o("sitting", "جالساً", "Sitting"), o("standing", "واقفاً", "Standing"), o("lying", "مستلقياً", "Lying"), o("left_arm", "الذراع اليسرى", "Left arm"), o("right_arm", "الذراع اليمنى", "Right arm"), o("after_exercise", "بعد جهد", "After exertion")],
  heart_rate: [o("resting", "راحة", "At rest"), o("after_exercise", "بعد جهد", "After exertion"), o("sleeping", "أثناء النوم", "Sleeping")],
  blood_glucose: [o("fasting", "صائم", "Fasting"), o("before_meal", "قبل الوجبة", "Before a meal"), o("post_meal_2h", "بعد الوجبة بساعتين", "2 h after a meal"), o("random", "عشوائي", "Random"), o("bedtime", "قبل النوم", "Bedtime")],
  cgm_glucose: [o("random", "عشوائي", "Random")],
  spo2: [o("resting", "راحة", "At rest"), o("after_exercise", "بعد جهد", "After exertion")],
  respiratory_rate: [o("resting", "راحة", "At rest"), o("after_exercise", "بعد جهد", "After exertion")],
  body_temperature: [o("oral", "فموي", "Oral"), o("axillary", "إبط", "Axillary"), o("ear", "أذن", "Ear"), o("forehead", "جبهة", "Forehead")],
  weight: [o("fasting", "صباحاً قبل الأكل", "Morning, before eating")],
};

export const INTERPRETATION: Record<string, { ar: string; en: string; tone: "ok" | "warn" | "bad" | "muted"; icon: string }> = {
  normal: { ar: "ضمن المجال", en: "In range", tone: "ok", icon: "check" },
  borderline: { ar: "حدّي", en: "Borderline", tone: "warn", icon: "alert" },
  low: { ar: "منخفض", en: "Low", tone: "warn", icon: "down" },
  high: { ar: "مرتفع", en: "High", tone: "warn", icon: "up" },
  critical_low: { ar: "منخفض جداً — يحتاج تقييماً", en: "Very low — needs assessment", tone: "bad", icon: "down" },
  critical_high: { ar: "مرتفع جداً — يحتاج تقييماً", en: "Very high — needs assessment", tone: "bad", icon: "up" },
  abnormal: { ar: "غير طبيعي", en: "Abnormal", tone: "warn", icon: "alert" },
  not_assessed: { ar: "غير مصنّف", en: "Not assessed", tone: "muted", icon: "dash" },
};

export const OBS_STATUS: Opt[] = [o("preliminary", "أولية", "Preliminary"), o("final", "معتمدة", "Final"), o("amended", "مصحَّحة (استُبدلت)", "Amended (superseded)"), o("entered_in_error", "أُدخلت بالخطأ", "Entered in error")];

export const SHARE_MODULES: Opt[] = [
  o("contact", "هاتف المريض وجهات الطوارئ", "Phone & emergency contacts"),
  o("other_conditions", "التشخيصات والحالات الأخرى", "Other diagnoses & conditions"),
  o("encounters", "الزيارات", "Visits"),
  o("observations", "القياسات والتحاليل", "Measurements & lab results"),
  o("procedures", "العمليات والإجراءات", "Procedures & surgeries"),
  o("imaging", "الأشعة والتصوير", "Imaging"),
  o("specialty_records", "سجلات التخصص (أسنان، عيون، قلب...)", "Specialty records (dental, eye, cardiac...)"),
  o("documents", "المستندات والتقارير", "Documents & reports"),
  o("notes", "الملاحظات السريرية", "Clinical notes"),
  o("care_plans", "خطط العلاج", "Care plans"),
  o("immunizations", "التطعيمات", "Immunizations"),
  o("family_history", "التاريخ العائلي", "Family history"),
];
export const SHARE_EVENT: Record<string, { ar: string; en: string }> = {
  created: { ar: "أُنشئت المشاركة", en: "Share created" }, revoked: { ar: "أُلغيت المشاركة", en: "Share revoked" },
  auto_revoked: { ar: "أُلغيت تلقائياً بعد محاولات PIN خاطئة", en: "Auto-revoked after repeated wrong PINs" },
  opened: { ar: "فُتحت بنجاح (PIN صحيح)", en: "Opened (correct PIN)" }, pin_failed: { ar: "محاولة PIN خاطئة", en: "Wrong PIN attempt" },
  locked: { ar: "قُفلت مؤقتاً", en: "Temporarily locked" }, locked_attempt: { ar: "محاولة أثناء القفل", en: "Attempt while locked" },
  blocked: { ar: "محاولة على رابط منتهٍ أو ملغى", en: "Attempt on an expired / revoked link" }, viewed: { ar: "عُرض الملف", en: "File viewed" },
  document_opened: { ar: "فُتح مستند", en: "Document opened" }, note_added: { ar: "أضاف الطبيب ملاحظة", en: "Doctor added a note" },
  session_ended: { ar: "أنهى الطبيب الجلسة", en: "Doctor ended the session" },
};

export function lbl(list: Opt[], value: string | null | undefined, lang: Lang): string {
  if (value == null || value === "") return "";
  const f = list.find((x) => x.value === value);
  return f ? f[lang] : value;
}

export const LAB_GROUP: Record<string, { ar: string; en: string }> = {
  hematology: { ar: "أمراض الدم (CBC)", en: "Hematology (CBC)" }, inflammation: { ar: "الالتهاب", en: "Inflammation" },
  chemistry: { ar: "الكيمياء الحيوية والسكر", en: "Chemistry & glucose" }, kidney: { ar: "وظائف الكلى", en: "Kidney function" },
  electrolytes: { ar: "الأملاح والمعادن", en: "Electrolytes & minerals" }, liver: { ar: "وظائف الكبد", en: "Liver function" },
  lipids: { ar: "الدهون", en: "Lipids" }, thyroid: { ar: "الغدة الدرقية", en: "Thyroid" }, hormones: { ar: "الهرمونات", en: "Hormones" },
  vitamins: { ar: "الفيتامينات والحديد", en: "Vitamins & iron" }, coagulation: { ar: "التخثر", en: "Coagulation" },
  urinalysis: { ar: "تحليل البول", en: "Urinalysis" }, stool: { ar: "تحليل البراز", en: "Stool tests" },
  immunology: { ar: "المناعة", en: "Immunology" }, infection: { ar: "العدوى", en: "Infection screening" },
  microbiology: { ar: "الميكروبيولوجيا والمزارع", en: "Microbiology & cultures" }, genetics: { ar: "الفحوصات الوراثية", en: "Genetic tests" },
  pregnancy: { ar: "الحمل", en: "Pregnancy" }, other: { ar: "أخرى", en: "Other" },
};
