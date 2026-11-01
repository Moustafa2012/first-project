import type { Opt } from "@/lib/labels";
import type { Lang } from "@/lib/i18n";
import { UUID_RE } from "@/lib/uuid";

/*
 * Consents with a drawn signature (migration 0027). The text shown at signing is stored with the consent (a snapshot);
 * the templates below only pre-fill the form and can be edited before the patient signs.
 */

export const CONSENT_KIND: Opt[] = [
  { value: "treatment", ar: "الموافقة على العلاج", en: "Consent to treatment" },
  { value: "surgery", ar: "موافقة على إجراء جراحي", en: "Consent to a surgical procedure" },
  { value: "anesthesia", ar: "موافقة على التخدير", en: "Consent to anaesthesia" },
  { value: "imaging", ar: "موافقة على التصوير بالأشعة", en: "Consent to imaging" },
  { value: "sedation", ar: "موافقة على التهدئة", en: "Consent to sedation" },
  { value: "other", ar: "موافقة أخرى", en: "Other consent" },
];
export const SIGNER_ROLE: Opt[] = [
  { value: "patient", ar: "المريض", en: "The patient" },
  { value: "guardian", ar: "ولي الأمر", en: "Guardian" },
  { value: "representative", ar: "ممثل قانوني", en: "Legal representative" },
];
export const CONSENT_STATUS: Opt[] = [
  { value: "signed", ar: "موقّعة", en: "Signed" },
  { value: "withdrawn", ar: "مسحوبة", en: "Withdrawn" },
  { value: "superseded", ar: "استُبدلت بنسخة أحدث", en: "Superseded" },
];

export interface ConsentRow {
  id: string; kind: string; title: string; version: number; body?: string; treatment_plan_id: string | null; treatment_item_id: string | null;
  signer_name: string; signer_role: string; signed_at: string; witness_name?: string | null; presented_by: string | null; status: string;
  withdrawn_at: string | null; withdrawn_reason: string | null; supersedes?: string | null; superseded_by?: string | null; contributed_by?: string | null; mine?: boolean;
}

type T = (ar: string, en: string) => string;
const PLAN_TEXT: [string, string] = [
  "شُرحت لي خطة العلاج، بما فيها طبيعة كل علاج وفائدته المتوقعة ومخاطره الشائعة والبدائل المتاحة (ومنها عدم العلاج)، وأُتيحت لي فرصة السؤال وحصلت على إجابات مفهومة. أوافق على العلاج المذكور وأعلم أن لي أن أسحب موافقتي في أي وقت قبل تنفيذه.",
  "The treatment, its nature, its expected benefit, its common risks and the alternatives (including no treatment) were explained to me, I could ask questions and the answers were clear. I agree to the treatment named and know I may withdraw my consent at any time before it is carried out.",
];
const TEMPLATES: Record<string, [string, string]> = {
  treatment: PLAN_TEXT,
  surgery: [
    "شُرح لي الإجراء الجراحي المذكور وسببه، ومخاطره الشائعة ومنها: الألم والتورم والنزف والعدوى وبطء الالتئام، وقد يشمل أيضاً تأثر الأعصاب المجاورة أو الجيوب الأنفية أو الأسنان المجاورة بحسب الموضع، وشُرحت لي البدائل ومنها عدم الإجراء، وتعليمات ما بعد الإجراء. أوافق صراحةً على الإجراء، وأعلم أن لي أن أسحب موافقتي قبل تنفيذه.",
    "The surgical procedure named and the reason for it were explained to me, with its common risks: pain, swelling, bleeding, infection and slow healing, and depending on the site possible effects on nearby nerves, the sinuses or neighbouring teeth. The alternatives, including not having it, and the after-care instructions were explained. I explicitly agree to the procedure and know I may withdraw my consent before it is carried out.",
  ],
  anesthesia: [
    "شُرح لي نوع التخدير المقترح (موضعي أو غيره) والغرض منه ومخاطره الشائعة ومنها التنميل المؤقت والكدمة وعدم كفاية التخدير وندرة التفاعلات التحسسية، وأخبرت الطبيب بكل حساسية أو دواء أتناوله. أوافق على التخدير.",
    "The proposed anaesthesia (local or other), its purpose and its common risks were explained to me, including temporary numbness, bruising, inadequate effect and rare allergic reactions, and I told the clinician of any allergy and every medicine I take. I agree to the anaesthesia.",
  ],
  imaging: [
    "شُرح لي سبب التصوير بالأشعة والجرعة المنخفضة المصاحبة له ووسائل الحماية، وأخبرت الطبيب إن كنتُ حاملاً أو أحتمل الحمل. أوافق على إجراء التصوير.",
    "The reason for the X-ray imaging, the low dose involved and the protective measures were explained to me, and I told the clinician if I am or may be pregnant. I agree to the imaging.",
  ],
  sedation: [
    "شُرحت لي التهدئة المقترحة (بالفم أو الاستنشاق أو الوريد) وأسبابها ومخاطرها ومنها النعاس وانخفاض التنفس أو الضغط، وتعليمات الصيام والمرافق وما بعد الإجراء. أوافق على التهدئة.",
    "The proposed sedation (oral, inhaled or intravenous), its reasons and risks, including drowsiness and lowered breathing or blood pressure, and the instructions on fasting, an escort and after-care were explained to me. I agree to the sedation.",
  ],
  other: [
    "شُرح لي ما أوافق عليه في هذه الوثيقة بوضوح، وأُتيحت لي فرصة السؤال. أوافق عليه، وأعلم أن لي أن أسحب موافقتي.",
    "What I am agreeing to in this document was explained to me clearly and I could ask questions. I agree, and know I may withdraw my consent.",
  ],
};

/** The text a consent starts from (editable before signing); `subject` names the treatment or plan it covers. */
export function consentTemplate(kind: string, lang: Lang, subject?: string | null): { title: string; body: string } {
  const k = CONSENT_KIND.find((x) => x.value === kind) ?? CONSENT_KIND[0];
  const text = (TEMPLATES[k.value] ?? TEMPLATES.other)[lang === "ar" ? 0 : 1];
  const about = subject ? (lang === "ar" ? `الإجراء أو الخطة: ${subject}\n\n` : `Procedure or plan: ${subject}\n\n`) : "";
  return { title: subject ? `${k[lang]} — ${subject}` : k[lang], body: about + text };
}

/** The consent fields of a posted form (the drawn signature is validated by the action). */
export function parseConsentForm(fd: FormData, t: T): { consent: Record<string, unknown> } | { error: string } {
  const get = (k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);
  const kind = get("kind", 20);
  if (!CONSENT_KIND.some((o) => o.value === kind)) return { error: t("اختر نوع الموافقة.", "Choose the kind of consent.") };
  const role = get("signer_role", 20);
  if (!SIGNER_ROLE.some((o) => o.value === role)) return { error: t("اختر صفة الموقّع.", "Choose who is signing.") };
  const signer = get("signer_name", 200);
  if (signer.length < 2) return { error: t("اكتب اسم الموقّع.", "Enter the signer's name.") };
  const title = get("title", 200);
  if (title.length < 2) return { error: t("اكتب عنوان الموافقة.", "Enter a title for the consent.") };
  const body = String(fd.get("body") ?? "").trim().slice(0, 20000);
  if (body.length < 10) return { error: t("نص الموافقة قصير جداً.", "The consent text is too short.") };
  const ids: Record<string, string | null> = {};
  for (const k of ["treatment_plan_id", "treatment_item_id", "supersedes"]) {
    const v = get(k, 40);
    if (v && !UUID_RE.test(v)) return { error: t("طلب غير صالح.", "Invalid request.") };
    ids[k] = v || null;
  }
  return { consent: { kind, title, body, signer_name: signer, signer_role: role, witness_name: get("witness_name", 200) || null, ...ids } };
}

export const CONSENT_ERRORS: Record<string, [string, string]> = {
  consent_signed: ["الموافقة الموقّعة لا تُعدَّل: اسحبها أو وقّع نسخة جديدة.", "A signed consent is not edited: withdraw it or sign a new version."],
  consent_not_signed: ["تُستبدل الموافقة الموقّعة فقط.", "Only a signed consent can be replaced."],
  consent_kind_mismatch: ["النسخة الجديدة من النوع نفسه.", "A new version is of the same kind."],
  consent_plan_mismatch: ["العلاج ليس من الخطة المذكورة.", "The treatment is not in the plan named."],
  invalid_transition: ["لا يمكن تغيير حالة هذه الموافقة.", "This consent's status cannot change."],
  reason_required: ["اكتب سبب السحب.", "Enter the reason for withdrawing."],
};
export function consentError(message: string, t: T): string | null {
  const k = Object.keys(CONSENT_ERRORS).find((x) => message.includes(x));
  return k ? t(...CONSENT_ERRORS[k]) : null;
}

/** The consents that cover a plan or one of its treatments, newest first. */
export function consentsForPlan<C extends Pick<ConsentRow, "treatment_plan_id" | "signed_at">>(consents: C[], planId: string): C[] {
  return consents.filter((c) => c.treatment_plan_id === planId).sort((a, b) => b.signed_at.localeCompare(a.signed_at));
}
