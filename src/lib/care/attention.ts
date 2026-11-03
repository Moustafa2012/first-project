/**
 * "Needs attention": what in a file asks for a look. The counts and the abnormal laboratory values come from the database
 * (public.care_attention and public.care_abnormal_labs, read with the caller's rights); this module reads the trend of a value
 * against the one before it and builds the list the dashboard and the patients list show. Indicators prompt a review; they
 * are not diagnoses.
 */

export type AttentionCode = "abnormal_labs" | "overdue" | "unreviewed" | "soft_tissue" | "expiring_shares" | "drafts";
export const ATTENTION_CODES: AttentionCode[] = ["soft_tissue", "abnormal_labs", "overdue", "unreviewed", "expiring_shares", "drafts"];
export type Tone = "bad" | "warn" | "info" | "muted";

/** A row of public.care_attention. */
export interface AttentionRow { patient_id: string; code: AttentionCode; n: number }

/** A row of public.care_abnormal_labs. */
export interface AbnormalLab {
  patient_id: string; observation_id: string; type_id: string; custom_name: string | null; value_num: number | null; value_text: string | null;
  unit: string | null; interpretation: string; effective_at: string; ref_low: number | null; ref_high: number | null;
  prev_value: number | null; prev_unit: string | null; prev_at: string | null;
}

/** Counts per file: { patient_id: { code: n } } */
export function countsByPatient(rows: AttentionRow[]): Map<string, Partial<Record<AttentionCode, number>>> {
  const out = new Map<string, Partial<Record<AttentionCode, number>>>();
  for (const r of rows) {
    const m = out.get(r.patient_id) ?? {};
    m[r.code] = (m[r.code] ?? 0) + Number(r.n);
    out.set(r.patient_id, m);
  }
  return out;
}

/** The chips on a file's card in the patients list: only indicators above zero, the most serious first. */
export function attentionBadges(counts: Partial<Record<AttentionCode, number>> | undefined, t: (ar: string, en: string) => string): { code: AttentionCode; tone: Tone; text: string }[] {
  if (!counts) return [];
  const n = (c: AttentionCode) => counts[c] ?? 0;
  const out: { code: AttentionCode; tone: Tone; text: string }[] = [];
  for (const code of ATTENTION_CODES) {
    const k = n(code);
    if (!k) continue;
    switch (code) {
      case "soft_tissue": out.push({ code, tone: "bad", text: t("آفة مشتبهة مفتوحة", "Open suspicious lesion") }); break;
      case "abnormal_labs": out.push({ code, tone: "warn", text: t(`${k} تحليل خارج المجال`, `${k} lab out of range`) }); break;
      case "overdue": out.push({ code, tone: "warn", text: t(`${k} متأخر`, `${k} overdue`) }); break;
      case "unreviewed": out.push({ code, tone: "info", text: t(`${k} إضافة بانتظار المراجعة`, `${k} to review`) }); break;
      case "expiring_shares": out.push({ code, tone: "info", text: t(`${k} مشاركة تنتهي قريباً`, `${k} share ending soon`) }); break;
      case "drafts": out.push({ code, tone: "muted", text: t(`${k} مسودة`, `${k} draft`) }); break;
    }
  }
  return out;
}

export interface Trend {
  /** the direction of the change against the previous value of the same unit; "none" when there is nothing comparable */
  dir: "up" | "down" | "flat" | "none";
  delta: number | null;
  /** toward or away from the reference range, when both values and a range are known */
  verdict: "improving" | "worsening" | "unchanged" | null;
}

/** How far a value lies outside the range (0 inside, or when it has no bounds at all). */
export function outsideBy(v: number, low: number | null, high: number | null): number {
  if (low != null && v < low) return low - v;
  if (high != null && v > high) return v - high;
  return 0;
}

/**
 * The trend of the latest value against the one before it. Values in different units are never compared (no arrow, no
 * verdict): a mg/dL reading is not set against a mmol/L one.
 */
export function labTrend(l: Pick<AbnormalLab, "value_num" | "unit" | "ref_low" | "ref_high" | "prev_value" | "prev_unit">): Trend {
  if (l.value_num == null || l.prev_value == null || (l.unit ?? "") !== (l.prev_unit ?? "")) return { dir: "none", delta: null, verdict: null };
  const delta = l.value_num - l.prev_value;
  const flat = Math.abs(delta) <= Math.abs(l.prev_value) * 0.005;
  const dir = flat ? "flat" : delta > 0 ? "up" : "down";
  let verdict: Trend["verdict"] = null;
  if (l.ref_low != null || l.ref_high != null) {
    const now = outsideBy(l.value_num, l.ref_low, l.ref_high), before = outsideBy(l.prev_value, l.ref_low, l.ref_high);
    verdict = Math.abs(now - before) < 1e-9 ? "unchanged" : now < before ? "improving" : "worsening";
  }
  return { dir, delta: Number(delta.toFixed(4)), verdict };
}

export interface AttentionItem { key: string; tone: Tone; text: string; href: string }

export interface AttentionInput {
  base: string;
  /** overdue reminders, most overdue first */
  overdue: { label: string; days: number; href: string }[];
  /** doctors' notes waiting, and the names of the clinicians whose additions have not been reviewed */
  unreviewed: { notes: number; clinicians: string[] };
  softTissue: boolean;
  /** active shares ending within three days */
  shares: { id: string; title: string; hoursLeft: number }[];
  drafts: { perio: number; notes: number };
  documentsNoDate: number; ordersOpen: number; suggested: number;
}

/** The dashboard list besides the laboratory values: one line per matter, the most serious first. */
export function buildAttention(i: AttentionInput, t: (ar: string, en: string) => string): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (i.softTissue) {
    out.push({ key: "soft_tissue", tone: "bad", href: `${i.base}/dental`, text: t("آفة مشتبهة مفتوحة في الأنسجة الرخوة: تحتاج متابعة أو تحويلاً لأخصائي.", "Open suspicious soft-tissue lesion: it needs follow-up or a specialist.") });
  }
  if (i.overdue.length) {
    const first = i.overdue.slice(0, 3).map((o) => o.label).filter(Boolean).join(t("، ", ", "));
    out.push({ key: "overdue", tone: "warn", href: `${i.base}/reminders`,
      text: t(`${i.overdue.length} متأخر${first ? `: ${first}` : ""}.`, `${i.overdue.length} overdue${first ? `: ${first}` : ""}.`) });
  }
  if (i.unreviewed.notes) out.push({ key: "notes", tone: "warn", href: `${i.base}/sharing`, text: t(`${i.unreviewed.notes} ملاحظة من طبيب بانتظار مراجعتك.`, `${i.unreviewed.notes} doctor note(s) waiting for your review.`) });
  for (const name of i.unreviewed.clinicians.slice(0, 3)) {
    out.push({ key: `clinician:${name}`, tone: "warn", href: `${i.base}/sharing`, text: t(`أضاف ${name} بيانات إلى ملفك عبر رابط مشاركة — راجعها من صفحة المشاركة.`, `${name} added to your file through a share link — review it on the share page.`) });
  }
  for (const s of i.shares) {
    const left = s.hoursLeft < 1 ? t("أقل من ساعة", "under an hour") : s.hoursLeft < 24 ? t(`${Math.round(s.hoursLeft)} ساعة`, `${Math.round(s.hoursLeft)} h`) : t(`${Math.round(s.hoursLeft / 24)} يوم`, `${Math.round(s.hoursLeft / 24)} d`);
    out.push({ key: `share:${s.id}`, tone: "info", href: `${i.base}/sharing/${s.id}`, text: t(`مشاركة «${s.title}» تنتهي خلال ${left}.`, `Share “${s.title}” ends in ${left}.`) });
  }
  if (i.drafts.perio) out.push({ key: "perio_draft", tone: "muted", href: `${i.base}/dental?tab=perio`, text: t("مخطط لثة مسودة لم يُنهَ.", "A periodontal chart draft is not finished.") });
  if (i.drafts.notes) out.push({ key: "note_drafts", tone: "muted", href: `${i.base}/notes`, text: t(`${i.drafts.notes} ملاحظة غير موقّعة.`, `${i.drafts.notes} unsigned note(s).`) });
  if (i.documentsNoDate) out.push({ key: "docs_no_date", tone: "muted", href: `${i.base}/documents`, text: t(`${i.documentsNoDate} مستند بلا تاريخ.`, `${i.documentsNoDate} document(s) without a date.`) });
  if (i.ordersOpen) out.push({ key: "orders", tone: "info", href: `${i.base}/test-orders`, text: t(`${i.ordersOpen} فحص طلبه طبيب ولم يُنجز.`, `${i.ordersOpen} test(s) ordered by a clinician not done yet.`) });
  if (i.suggested) out.push({ key: "suggested", tone: "info", href: `${i.base}/test-orders`, text: t(`${i.suggested} فحص مقترح بانتظار قرار الطبيب.`, `${i.suggested} suggested test(s) awaiting a clinician’s decision.`) });
  return out;
}
