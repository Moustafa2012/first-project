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
  o("chronic", "مرض مزمن", "Chronic condition"), o("congenital", "عيب خلقي", "Congenital condition"), o("genetic", "مرض وراثي", "Genetic condition"),
  o("diagnosis", "تشخيص", "Diagnosis"), o("acute", "مرض حاد", "Acute condition"), o("mental_health", "صحة نفسية", "Mental health"),
  o("disability", "إعاقة", "Disability"), o("other", "أخرى", "Other"),
];
export const CLINICAL_STATUS: Opt[] = [
  o("active", "نشط", "Active"), o("recurrence", "نكس (عاد)", "Recurrence"), o("inactive", "كامن (غير نشط)", "Inactive"),
  o("remission", "هاجع (هدأ)", "In remission"), o("resolved", "شُفي / انتهى", "Resolved"),
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
// "uncle" / "aunt" / "cousin" stay for older entries where the side of the family is unknown.
export const FAMILY_RELATION: Opt[] = [
  "father:الأب:Father", "mother:الأم:Mother", "brother:أخ:Brother", "sister:أخت:Sister", "half_sibling:أخ / أخت غير شقيق:Half-sibling",
  "son:ابن:Son", "daughter:ابنة:Daughter",
  "paternal_grandfather:الجد لأب:Paternal grandfather", "paternal_grandmother:الجدة لأب:Paternal grandmother",
  "maternal_grandfather:الجد لأم:Maternal grandfather", "maternal_grandmother:الجدة لأم:Maternal grandmother",
  "grandfather:الجد (الجهة غير معروفة):Grandfather (side unknown)", "grandmother:الجدة (الجهة غير معروفة):Grandmother (side unknown)",
  "paternal_uncle:العم (أخو الأب):Paternal uncle", "paternal_aunt:العمة (أخت الأب):Paternal aunt",
  "maternal_uncle:الخال (أخو الأم):Maternal uncle", "maternal_aunt:الخالة (أخت الأم):Maternal aunt",
  "uncle:عم أو خال (غير محدد):Uncle (side unknown)", "aunt:عمة أو خالة (غير محددة):Aunt (side unknown)",
  "paternal_cousin:ابن / ابنة العم أو العمة:Paternal cousin", "maternal_cousin:ابن / ابنة الخال أو الخالة:Maternal cousin",
  "cousin:ابن / ابنة عم أو خال (غير محدد):Cousin (side unknown)",
  "nephew_niece:ابن / ابنة الأخ أو الأخت:Nephew / niece", "grandchild:حفيد / حفيدة:Grandchild",
  "male_relatives:عدة أقارب ذكور:Several male relatives", "female_relatives:عدة أقارب إناث:Several female relatives",
  "other:قريب آخر:Other relative",
].map((s) => { const [v, a, e] = s.split(":"); return o(v, a, e); });
// How much of a date is known. Month / year dates are stored as the first day of that month / year.
export const DATE_PRECISION: Opt[] = [
  o("day", "اليوم معروف", "Exact day"), o("month", "الشهر فقط", "Month only"), o("year", "السنة فقط", "Year only"), o("approx", "سنة تقريبية", "Approximate year"),
];
// what a clinician may add through a share link (table names, as accepted by public.share_contribute)
export const DIAGNOSIS_EVIDENCE: Opt[] = [
  o("patient_reported", "إفادة المريض", "Patient-reported"), o("clinical", "فحص سريري", "Clinical examination"),
  o("radiographic", "صورة أشعة", "Radiograph"), o("clinical_radiographic", "سريري وشعاعي", "Clinical and radiographic"),
  o("unknown", "غير محدد", "Not stated"),
];
export const CONTRIB_MODULES: Opt[] = [
  o("encounters", "زيارة (سبب، فحص، تقييم، خطة)", "Visit (reason, exam, assessment, plan)"),
  o("conditions", "تشخيص أو مرض", "Diagnosis / condition"),
  o("procedures", "إجراء منجز", "Procedure performed"),
  o("clinical_notes", "ملاحظة سريرية", "Clinical note"),
  o("medications", "دواء / وصفة", "Medication / prescription"),
  o("appointments", "موعد متابعة", "Follow-up appointment"),
  o("test_orders", "طلب فحص أو أشعة", "Test or imaging request"),
  o("imaging_studies", "دراسة تصوير (أشعة)", "Imaging study"),
  o("medical_documents", "رفع مستند أو صورة", "Upload a document or image"),
  o("dental_exams", "فحص أسنان على المخطط (طب الأسنان فقط)", "Dental exam on the chart (dentistry only)"),
  o("treatment_plans", "خطة علاج أسنان: اقتراح العلاج وتسجيل إنجازه (طب الأسنان فقط)", "Dental treatment plan: propose treatment and record it done (dentistry only)"),
];
/** the entity definition (src/lib/entities.ts) that describes each contributable table's fields */
export const CONTRIB_ENTITY: Record<string, string> = {
  encounters: "visits", conditions: "conditions", procedures: "procedures", clinical_notes: "notes", medications: "medications",
  appointments: "appointments", test_orders: "test-orders", imaging_studies: "imaging",
};
export const FAMILY_CERTAINTY: Opt[] = [o("reported", "أفاد به المريض", "Reported"), o("confirmed", "مؤكد", "Confirmed"), o("unknown", "غير معروف", "Unknown")];
export const APPOINTMENT_STATUS: Opt[] = [o("scheduled", "مجدول", "Scheduled"), o("completed", "تم", "Attended"), o("cancelled", "ملغى", "Cancelled"), o("no_show", "لم يحضر", "No-show")];
export const CARE_PLAN_STATUS: Opt[] = [o("draft", "مسودة", "Draft"), o("active", "نشطة", "Active"), o("on_hold", "موقوفة", "On hold"), o("completed", "مكتملة", "Completed"), o("cancelled", "ملغاة", "Cancelled")];
export const ANESTHESIA_KIND: Opt[] = [
  o("none", "بلا تخدير", "None"), o("topical", "موضعي سطحي (جل/رذاذ)", "Topical"), o("local_infiltration", "موضعي بالارتشاح", "Local infiltration"),
  o("nerve_block", "إحصار عصبي (مثل السني السفلي)", "Nerve block"), o("intraligamentary", "داخل الرباط", "Intraligamentary"),
  o("nitrous_oxide", "غاز الضحك (أكسيد النيتروز)", "Nitrous oxide"), o("sedation_oral", "تهدئة بالفم", "Oral sedation"),
  o("sedation_iv", "تهدئة وريدية", "IV sedation"), o("general", "تخدير عام", "General anaesthesia"),
];
export const RECALL_KIND: Opt[] = [
  o("dental_checkup", "فحص الأسنان الدوري", "Dental check-up"), o("dental_cleaning", "تنظيف الأسنان", "Dental cleaning"),
  o("dental_xray", "صور الأشعة الدورية", "Routine X-rays"), o("perio_maintenance", "صيانة اللثة", "Periodontal maintenance"),
  o("ortho_review", "مراجعة التقويم", "Orthodontic review"), o("other", "أخرى", "Other"),
];
export const RECALL_STATUS: Opt[] = [o("active", "فعّال", "Active"), o("paused", "موقوف مؤقتاً", "Paused"), o("stopped", "متوقف", "Stopped")];
export const NOTE_STATUS: Opt[] = [o("draft", "مسودة", "Draft"), o("signed", "موقّعة", "Signed")];
export const NOTE_KIND: Opt[] = [o("progress", "ملاحظة متابعة", "Progress note"), o("consult", "استشارة", "Consultation"), o("nursing", "تمريض", "Nursing"), o("patient_note", "ملاحظة المريض", "Patient note"), o("other", "أخرى", "Other")];
export const ORDER_KIND: Opt[] = [o("lab", "تحليل مخبري", "Lab test"), o("imaging", "تصوير", "Imaging"), o("clinical", "فحص سريري", "Clinical exam"), o("other", "أخرى", "Other")];
export const ORDER_PRIORITY: Opt[] = [o("routine", "عادي", "Routine"), o("soon", "قريباً", "Soon"), o("urgent", "عاجل", "Urgent")];
export const ORDER_STATUS: Opt[] = [o("suggested", "مقترح (لم يطلبه طبيب)", "Suggested (not ordered)"), o("requested", "طلبه طبيب", "Ordered by a clinician"), o("done", "تم", "Done"), o("cancelled", "ملغى", "Cancelled")];
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
  contributor_identified: { ar: "عرّف الطبيب بنفسه ووقّع", en: "Doctor identified and signed" },
  contribution_added: { ar: "أضاف الطبيب سجلاً", en: "Doctor added a record" },
  contribution_retracted: { ar: "سحب الطبيب سجلاً أضافه", en: "Doctor withdrew a record" },
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
  lipids: { ar: "الدهون", en: "Lipids" }, cardiac: { ar: "مؤشرات القلب", en: "Cardiac markers" }, thyroid: { ar: "الغدة الدرقية", en: "Thyroid" }, hormones: { ar: "الهرمونات", en: "Hormones" },
  vitamins: { ar: "الفيتامينات والحديد", en: "Vitamins & iron" }, coagulation: { ar: "التخثر", en: "Coagulation" },
  urinalysis: { ar: "تحليل البول", en: "Urinalysis" }, stool: { ar: "تحليل البراز", en: "Stool tests" },
  immunology: { ar: "المناعة", en: "Immunology" }, infection: { ar: "العدوى", en: "Infection screening" },
  microbiology: { ar: "الميكروبيولوجيا والمزارع", en: "Microbiology & cultures" }, genetics: { ar: "الفحوصات الوراثية", en: "Genetic tests" },
  pregnancy: { ar: "الحمل", en: "Pregnancy" }, other: { ar: "أخرى", en: "Other" },
};

// ---------------------------------------------------------------- core file (0016)
export const DEVICE_KIND: Opt[] = [
  o("prosthetic_heart_valve", "صمام قلب صناعي", "Prosthetic heart valve"), o("pacemaker", "منظم ضربات القلب", "Pacemaker"),
  o("icd", "مزيل رجفان مزروع (ICD)", "Implantable defibrillator (ICD)"), o("coronary_stent", "دعامة شريان تاجي", "Coronary stent"),
  o("vascular_graft", "طُعم أو دعامة وعائية", "Vascular graft / stent"), o("joint_replacement", "مفصل صناعي", "Joint replacement"),
  o("spinal_hardware", "تثبيت فقرات", "Spinal hardware"), o("fracture_hardware", "صفائح أو مسامير كسر", "Fracture plates / screws"),
  o("cochlear_implant", "زرعة قوقعة", "Cochlear implant"), o("breast_implant", "حشوة ثدي", "Breast implant"),
  o("neurostimulator", "منبّه عصبي", "Neurostimulator"), o("shunt", "تحويلة (Shunt)", "Shunt"), o("insulin_pump", "مضخة إنسولين", "Insulin pump"),
  o("iud", "لولب رحمي", "Intrauterine device"), o("dental_implant", "زرعة سنية", "Dental implant"), o("other", "أخرى", "Other"),
];
export const MRI_SAFETY: Opt[] = [o("unknown", "غير معروف", "Unknown"), o("safe", "آمن", "MR safe"), o("conditional", "آمن بشروط", "MR conditional"), o("unsafe", "غير آمن", "MR unsafe")];
export const DEVICE_STATUS: Opt[] = [o("in_place", "مزروع حالياً", "In place"), o("removed", "أُزيل", "Removed")];
export const TOBACCO_STATUS: Opt[] = [o("unknown", "غير محدد", "Not stated"), o("never", "لم يدخّن قط", "Never smoked"), o("former", "مدخّن سابق", "Former smoker"), o("current", "مدخّن حالياً", "Current smoker")];
export const TOBACCO_TYPE: Opt[] = [o("cigarettes", "سجائر", "Cigarettes"), o("waterpipe", "أرجيلة / شيشة", "Waterpipe (shisha)"), o("cigars", "سيجار", "Cigars"),
  o("pipe", "غليون", "Pipe"), o("smokeless", "تبغ ممضوغ / نشوق", "Smokeless tobacco"), o("e_cigarette", "سيجارة إلكترونية", "E-cigarette")];
export const ALCOHOL_STATUS: Opt[] = [o("unknown", "غير محدد", "Not stated"), o("none", "لا يشرب", "None"), o("occasional", "أحياناً", "Occasional"), o("regular", "بانتظام", "Regular"), o("former", "سابقاً", "Former")];
export const ACTIVITY_LEVEL: Opt[] = [o("sedentary", "خامل", "Sedentary"), o("light", "خفيف", "Light"), o("moderate", "متوسط", "Moderate"), o("active", "نشيط", "Active")];
export const PREGNANCY_STATUS: Opt[] = [o("unknown", "غير محدد", "Not stated"), o("not_pregnant", "غير حامل", "Not pregnant"), o("pregnant", "حامل", "Pregnant"), o("not_applicable", "لا ينطبق", "Not applicable")];

/** suggestions for the specialty of the doctor a share is for (free text is allowed) */
export const CLINICIAN_SPECIALTIES: [string, string][] = [
  ["طب الأسنان العام", "General dentistry"], ["علاج اللثة", "Periodontics"], ["علاج العصب (اللبّ)", "Endodontics"],
  ["جراحة الفم والفكين", "Oral & maxillofacial surgery"], ["تقويم الأسنان", "Orthodontics"], ["التركيبات وتعويض الأسنان", "Prosthodontics"],
  ["طب أسنان الأطفال", "Paediatric dentistry"], ["أشعة الفم والفكين", "Oral & maxillofacial radiology"], ["طب الفم", "Oral medicine"],
  ["طب الأسرة", "Family medicine"], ["الباطنة", "Internal medicine"], ["القلب", "Cardiology"], ["الغدد الصماء والسكري", "Endocrinology & diabetes"],
  ["النساء والولادة", "Obstetrics & gynaecology"], ["الأطفال", "Paediatrics"], ["العظام", "Orthopaedics"], ["الجلدية", "Dermatology"],
  ["العيون", "Ophthalmology"], ["الأنف والأذن والحنجرة", "ENT"], ["المسالك البولية", "Urology"], ["الأعصاب", "Neurology"], ["الطب النفسي", "Psychiatry"],
];

// ---------------------------------------------------------------- general completion (0028): social history, symptoms
export const DIET_PATTERN: Opt[] = [o("balanced", "متوازن", "Balanced"), o("vegetarian", "نباتي (بيض وألبان)", "Vegetarian"), o("vegan", "نباتي صرف", "Vegan"), o("low_carb", "قليل النشويات", "Low carbohydrate"),
  o("diabetic", "حمية السكري", "Diabetic diet"), o("low_salt", "قليل الملح", "Low salt"), o("high_protein", "عالي البروتين", "High protein"), o("irregular", "غير منتظم", "Irregular"), o("other", "أخرى", "Other")];
export const SLEEP_QUALITY: Opt[] = [o("good", "جيد", "Good"), o("fair", "متوسط", "Fair"), o("poor", "سيئ", "Poor")];
export const SUBSTANCE_STATUS: Opt[] = [o("unknown", "غير محدد", "Not stated"), o("none", "لا يتعاطى", "None"), o("former", "سابقاً", "Former"), o("current", "حالياً", "Current")];
export const SUBSTANCE_TYPE: Opt[] = [o("cannabis", "قنب (حشيش)", "Cannabis"), o("stimulants", "منشطات", "Stimulants"), o("opioids", "أفيونات", "Opioids"), o("sedatives", "مهدئات", "Sedatives"),
  o("hallucinogens", "مهلوسات", "Hallucinogens"), o("inhalants", "مستنشقات", "Inhalants"), o("khat", "قات", "Khat"), o("other", "أخرى", "Other")];
export const LIVING_SITUATION: Opt[] = [o("alone", "يعيش وحده", "Lives alone"), o("with_spouse", "مع الزوج / الزوجة", "With spouse"), o("with_family", "مع الأسرة", "With family"),
  o("with_roommates", "مع آخرين (سكن مشترك)", "With others (shared housing)"), o("care_facility", "دار رعاية", "Care facility"), o("other", "أخرى", "Other")];
export const EXPOSURE_KIND: Opt[] = [o("dust", "غبار", "Dust"), o("silica", "سيليكا", "Silica"), o("asbestos", "أسبستوس", "Asbestos"), o("chemicals", "مواد كيميائية", "Chemicals"),
  o("solvents", "مذيبات", "Solvents"), o("pesticides", "مبيدات", "Pesticides"), o("fumes", "أبخرة ودخان", "Fumes / smoke"), o("radiation", "إشعاع", "Radiation"), o("noise", "ضوضاء", "Noise"),
  o("heat", "حرارة شديدة", "Extreme heat"), o("vibration", "اهتزاز", "Vibration"), o("biological", "عوامل حيوية (عدوى، حيوانات)", "Biological (infection, animals)"),
  o("secondhand_smoke", "تدخين سلبي", "Second-hand smoke"), o("other", "أخرى", "Other")];
export const EXPOSURE_SETTING: Opt[] = [o("work", "العمل", "Work"), o("home", "المنزل", "Home"), o("environment", "البيئة المحيطة", "Environment"), o("other", "أخرى", "Other")];
export const PROTECTIVE_EQUIPMENT: Opt[] = [o("unknown", "غير معروف", "Unknown"), o("none", "لا يستخدم", "None"), o("sometimes", "أحياناً", "Sometimes"), o("always", "دائماً", "Always")];
export const SYMPTOM_PATTERN: Opt[] = [o("constant", "مستمر", "Constant"), o("intermittent", "متقطع", "Intermittent"), o("episodic", "نوبات", "Episodic"),
  o("worsening", "يزداد سوءاً", "Worsening"), o("improving", "يتحسن", "Improving"), o("unknown", "غير معروف", "Unknown")];
