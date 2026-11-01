import { MED_FORM, MED_ROUTE, type Opt } from "@/lib/labels";
import type { Lang } from "@/lib/i18n";

/*
 * Prescriptions (migration 0027): a prescription groups medication lines. The form posts `l{i}_{field}` for each line;
 * blank lines are ignored. Parsing is here (pure) so it is tested without a browser; the database checks it again.
 */

export const RX_STATUS: Opt[] = [
  { value: "active", ar: "سارية", en: "Active" }, { value: "completed", ar: "اكتملت", en: "Completed" }, { value: "cancelled", ar: "ملغاة", en: "Cancelled" },
];
export const MAX_RX_LINES = 20;
export const FORM_LINES = 8;                       // lines the form can offer at most in one go; the database allows MAX_RX_LINES

export interface RxLine {
  id?: string; name_generic: string | null; name_brand: string | null; strength: string | null; form: string | null; dose: string | null; route: string | null;
  frequency: string | null; as_needed: boolean; quantity: string | null; duration_days: number | null; refills: number | null; instructions: string | null;
  indication: string | null; end_date?: string | null; status?: string;
}
export interface Rx {
  id: string; prescriber_name: string; prescriber_license: string | null; facility_name: string | null; issued_on: string; status: string;
  status_reason: string | null; notes: string | null; contributed_by: string | null; specialty_id?: string | null; mine?: boolean; lines: RxLine[];
}

type T = (ar: string, en: string) => string;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_TEXT: [keyof RxLine, number][] = [
  ["name_generic", 200], ["name_brand", 200], ["strength", 60], ["dose", 100], ["frequency", 100], ["quantity", 60], ["instructions", 2000], ["indication", 500],
];

/** The lines of a posted form as the database function expects them, or the first mistake in words. */
export function parseRxLines(fd: FormData, t: T): { lines: Record<string, unknown>[] } | { error: string } {
  const lines: Record<string, unknown>[] = [];
  for (let i = 0; i < MAX_RX_LINES; i++) {
    const get = (k: string) => String(fd.get(`l${i}_${k}`) ?? "").trim();
    const any = ["name_generic", "name_brand", "strength", "dose", "frequency", "quantity", "duration_days", "refills", "instructions", "indication"].some((k) => get(k) !== "");
    if (!any) continue;
    const n = lines.length + 1;
    if (!get("name_generic") && !get("name_brand")) return { error: t(`السطر ${n}: اكتب اسم الدواء.`, `Line ${n}: enter the medicine name.`) };
    const line: Record<string, unknown> = {};
    for (const [k, max] of LINE_TEXT) {
      const v = get(k);
      if (v.length > max) return { error: t(`السطر ${n}: نص طويل جداً.`, `Line ${n}: text too long.`) };
      if (v) line[k] = v;
    }
    const form = get("form"), route = get("route");
    if (form) { if (!MED_FORM.some((o) => o.value === form)) return { error: t(`السطر ${n}: شكل دوائي غير صالح.`, `Line ${n}: invalid form.`) }; line.form = form; }
    if (route) { if (!MED_ROUTE.some((o) => o.value === route)) return { error: t(`السطر ${n}: طريق إعطاء غير صالح.`, `Line ${n}: invalid route.`) }; line.route = route; }
    const dur = get("duration_days"), ref = get("refills");
    if (dur) {
      const d = Number(dur);
      if (!Number.isInteger(d) || d < 1 || d > 3650) return { error: t(`السطر ${n}: المدة بالأيام من 1 إلى 3650.`, `Line ${n}: the duration is 1 to 3650 days.`) };
      line.duration_days = d;
    }
    if (ref) {
      const r = Number(ref);
      if (!Number.isInteger(r) || r < 0 || r > 24) return { error: t(`السطر ${n}: عدد مرات التجديد من 0 إلى 24.`, `Line ${n}: refills are 0 to 24.`) };
      line.refills = r;
    }
    if (fd.get(`l${i}_as_needed`) === "on") line.as_needed = true;
    lines.push(line);
  }
  if (!lines.length) return { error: t("أضف دواءً واحداً على الأقل.", "Add at least one medicine.") };
  return { lines };
}

/** The prescription header of a posted form (the patient records who prescribed it). `today` is the viewer's local date. */
export function parseRxHeader(fd: FormData, t: T, today: string): { rx: Record<string, unknown> } | { error: string } {
  const get = (k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);
  const name = get("prescriber_name", 200);
  if (name.length < 2) return { error: t("اكتب اسم الطبيب الواصف.", "Enter the prescriber's name.") };
  const issued = get("issued_on", 10) || today;
  if (!DATE_RE.test(issued) || Number.isNaN(Date.parse(issued))) return { error: t("تاريخ الوصفة غير صالح.", "Invalid prescription date.") };
  if (issued > today) return { error: t("تاريخ الوصفة في المستقبل.", "The prescription date is in the future.") };
  return {
    rx: {
      prescriber_name: name, prescriber_license: get("prescriber_license", 60) || null, facility_name: get("facility_name", 200) || null,
      issued_on: issued, notes: get("notes", 2000) || null,
    },
  };
}

/** Database errors of the prescription functions, in words. */
export const RX_ERRORS: Record<string, [string, string]> = {
  prescription_needs_lines: ["أضف دواءً واحداً على الأقل.", "Add at least one medicine."],
  prescription_too_long: ["الوصفة طويلة: 20 دواءً كحدّ أقصى.", "The prescription is too long: 20 medicines at most."],
  medication_name_required: ["لكل دواء اسم علمي أو تجاري.", "Every medicine needs a generic or brand name."],
  prescriber_required: ["اكتب اسم الطبيب الواصف.", "Enter the prescriber's name."],
  date_in_future: ["تاريخ الوصفة في المستقبل.", "The prescription date is in the future."],
  prescription_closed: ["الوصفة مكتملة أو ملغاة؛ لا تُعدَّل ولا يُضاف إليها.", "The prescription is completed or cancelled; it is not edited or added to."],
  invalid_transition: ["لا يمكن تغيير حالة الوصفة من حالتها الحالية.", "The prescription's status cannot change from where it is."],
};
export function rxError(message: string, t: T): string | null {
  const k = Object.keys(RX_ERRORS).find((x) => message.includes(x));
  return k ? t(...RX_ERRORS[k]) : null;
}

const joinDot = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");
export const lineTitle = (l: Pick<RxLine, "name_generic" | "name_brand" | "strength" | "form">, lang: Lang): string =>
  joinDot([[l.name_generic, l.name_brand && `(${l.name_brand})`].filter(Boolean).join(" "), l.strength, l.form && (MED_FORM.find((o) => o.value === l.form)?.[lang] ?? l.form)]);

/** "1 capsule · three times a day · 7 days · quantity 21 capsules · refills 0" */
export function lineSig(l: RxLine, lang: Lang): string {
  const t: T = (ar, en) => (lang === "ar" ? ar : en);
  return joinDot([
    l.dose, l.route && (MED_ROUTE.find((o) => o.value === l.route)?.[lang] ?? l.route), l.frequency, l.as_needed && t("عند الحاجة", "as needed"),
    l.duration_days != null && t(`${l.duration_days} يوماً`, `${l.duration_days} days`), l.quantity && t(`الكمية: ${l.quantity}`, `quantity: ${l.quantity}`),
    l.refills != null && t(`التجديد: ${l.refills}`, `refills: ${l.refills}`),
  ]);
}

/** Medicine names of a set of prescriptions that are in force, for the drug rules of the safety alerts. */
export function activeDrugNames(rxs: Pick<Rx, "status" | "lines">[]): string[] {
  return rxs.filter((r) => r.status === "active").flatMap((r) => r.lines.filter((l) => !l.status || l.status === "active" || l.status === "on_hold")
    .flatMap((l) => [l.name_generic, l.name_brand].filter((x): x is string => Boolean(x))));
}

/** Rows from public.prescriptions + public.medications into the shape the screens use. */
export function groupPrescriptions(rxRows: Record<string, unknown>[], medRows: Record<string, unknown>[]): Rx[] {
  return rxRows.map((r) => ({
    id: String(r.id), prescriber_name: String(r.prescriber_name), prescriber_license: (r.prescriber_license as string | null) ?? null,
    facility_name: (r.facility_name as string | null) ?? null, issued_on: String(r.issued_on), status: String(r.status), status_reason: (r.status_reason as string | null) ?? null,
    notes: (r.notes as string | null) ?? null, contributed_by: (r.contributed_by as string | null) ?? null, specialty_id: (r.specialty_id as string | null) ?? null,
    lines: medRows.filter((m) => m.prescription_id === r.id).sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at))).map((m): RxLine => ({
      id: String(m.id), name_generic: (m.name_generic as string | null) ?? null, name_brand: (m.name_brand as string | null) ?? null, strength: (m.strength as string | null) ?? null,
      form: (m.form as string | null) ?? null, dose: (m.dose as string | null) ?? null, route: (m.route as string | null) ?? null, frequency: (m.frequency as string | null) ?? null,
      as_needed: Boolean(m.as_needed), quantity: (m.quantity as string | null) ?? null, duration_days: (m.duration_days as number | null) ?? null,
      refills: (m.refills as number | null) ?? null, instructions: (m.instructions as string | null) ?? null, indication: (m.indication as string | null) ?? null,
      end_date: (m.end_date as string | null) ?? null, status: (m.status as string | undefined),
    })),
  }));
}
