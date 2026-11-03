/**
 * Reminders: what is coming up or overdue in a file. The list itself is made by the database (public.care_reminder_feed, read
 * with the caller's rights); this module turns its rows into items to show: when each is due, how urgent, where it leads.
 *
 * Nothing here sends anything. There is no e-mail or SMS provider; a provider would read the same feed (see channels.ts).
 */

export type ReminderKind = "recall" | "medication_end" | "medication_refill" | "prescription_end" | "test_order" | "appointment" | "custom";
export const REMINDER_KINDS: ReminderKind[] = ["recall", "medication_end", "medication_refill", "prescription_end", "test_order", "appointment", "custom"];

/** A row of public.care_reminder_feed. */
export interface FeedRow {
  kind: ReminderKind; code: string | null; patient_id: string; ref_id: string; due_on: string; label: string | null; detail: string | null; at_time: string | null;
}

/** overdue: before today · today · soon: within a week · upcoming: later (inside the feed's horizon) */
export type ReminderState = "overdue" | "today" | "soon" | "upcoming";
/** How many days ahead counts as "soon" (the same limit the database uses for the number on the bell). */
export const SOON_DAYS = 7;

const DAY = 86_400_000;
/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/**
 * The state of one reminder. A reminder somebody wrote for themselves is shown from its lead time on, so it is "soon"
 * as soon as it appears (unless it is today or past).
 */
export function reminderState(kind: ReminderKind, due: string, today: string): ReminderState {
  const d = daysBetween(today, due);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (kind === "custom" || d <= SOON_DAYS) return "soon";
  return "upcoming";
}

export interface ReminderItem {
  key: string; kind: ReminderKind; code: string | null; patientId: string; refId: string; due: string; days: number; state: ReminderState;
  label: string; detail: string; atTime: string | null; href: string;
}

const STATE_RANK: Record<ReminderState, number> = { overdue: 0, today: 1, soon: 2, upcoming: 3 };

/** Where a reminder leads: the page of the record it came from. */
export function reminderHref(kind: ReminderKind, patientId: string): string {
  const base = `/patients/${patientId}`;
  switch (kind) {
    case "recall": return `${base}/dental?tab=followup`;
    case "medication_end": case "medication_refill": return `${base}/medications`;
    case "prescription_end": return `${base}/medications#prescriptions`;
    case "test_order": return `${base}/test-orders`;
    case "appointment": return `${base}/appointments`;
    default: return `${base}/reminders`;
  }
}

/** The feed as items: overdue first (the longest overdue first), then by date; `label` falls back to "" when the row has none. */
export function toItems(rows: FeedRow[], today: string): ReminderItem[] {
  return rows.map((r) => ({
    key: `${r.kind}:${r.ref_id}`, kind: r.kind, code: r.code, patientId: r.patient_id, refId: r.ref_id, due: r.due_on,
    days: daysBetween(today, r.due_on), state: reminderState(r.kind, r.due_on, today), label: r.label ?? "", detail: r.detail ?? "",
    atTime: r.at_time, href: reminderHref(r.kind, r.patient_id),
  })).sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.due.localeCompare(b.due) || a.key.localeCompare(b.key));
}

/** What the number on the bell counts: everything overdue or due within a week, and every reminder written for oneself that is inside its lead time. */
export function dueCount(items: ReminderItem[]): number {
  return items.filter((i) => i.kind === "custom" || i.days <= SOON_DAYS).length;
}

export function countByState(items: ReminderItem[]): Record<ReminderState, number> {
  const out: Record<ReminderState, number> = { overdue: 0, today: 0, soon: 0, upcoming: 0 };
  for (const i of items) out[i.state]++;
  return out;
}

/** Items grouped by file, in the order of first appearance (so the most urgent file comes first). */
export function groupByPatient(items: ReminderItem[]): { patientId: string; items: ReminderItem[] }[] {
  const out: { patientId: string; items: ReminderItem[] }[] = [];
  for (const i of items) {
    const g = out.find((x) => x.patientId === i.patientId);
    if (g) g.items.push(i); else out.push({ patientId: i.patientId, items: [i] });
  }
  return out;
}

/** "2/3" (refill 2 of 3) from the feed's detail. */
export function parseRefill(detail: string | null | undefined): { n: number; of: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(detail ?? "");
  return m ? { n: Number(m[1]), of: Number(m[2]) } : null;
}

type T = (ar: string, en: string) => string;

/** The sentence a reminder shows. `recallName` turns a recall kind code into its name (the labels live with the dental module). */
export function describeReminder(i: Pick<ReminderItem, "kind" | "code" | "label" | "detail" | "state">, t: T, recallName: (code: string | null, label: string) => string): string {
  const overdue = i.state === "overdue";
  switch (i.kind) {
    case "recall": return recallName(i.code, i.label);
    case "medication_end": return overdue
      ? t(`انتهت مدة ${i.label} وما زال مسجلاً كنشط`, `${i.label} has ended but is still marked active`)
      : t(`تنتهي مدة ${i.label}`, `${i.label} ends`);
    case "medication_refill": {
      const r = parseRefill(i.detail);
      return r ? t(`إعادة صرف ${i.label} (${r.n} من ${r.of})`, `Refill of ${i.label} (${r.n} of ${r.of})`) : t(`إعادة صرف ${i.label}`, `Refill of ${i.label}`);
    }
    case "prescription_end": return overdue
      ? t(`انتهت وصفة ${i.label} وما زالت نشطة`, `The prescription from ${i.label} has ended but is still active`)
      : t(`تنتهي وصفة ${i.label}`, `The prescription from ${i.label} ends`);
    case "test_order": return t(`فحص مطلوب لم يُنجز: ${i.label}`, `Requested test not done: ${i.label}`);
    case "appointment": return t(`موعد: ${i.label}`, `Appointment: ${i.label}`);
    default: return i.label;
  }
}

/** "3 days overdue" · "today" · "in 5 days" */
export function dueText(days: number, t: T): string {
  if (days < 0) return t(`متأخر ${-days} يوم`, `${-days} day${-days === 1 ? "" : "s"} overdue`);
  if (days === 0) return t("اليوم", "today");
  if (days === 1) return t("غداً", "tomorrow");
  return t(`بعد ${days} يوم`, `in ${days} days`);
}
