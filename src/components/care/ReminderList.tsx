import Link from "next/link";
import { CalendarClock, Check, Pill, Repeat, TestTube2, FileText, Bell } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { RECALL_KIND, lbl } from "@/lib/labels";
import { describeReminder, dueText, type ReminderItem, type ReminderKind } from "@/lib/care/reminders";
import { Chip } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { dismissReminder, reminderDone } from "@/app/actions/care";

const ICON: Record<ReminderKind, typeof Bell> = { recall: CalendarClock, medication_end: Pill, medication_refill: Repeat, prescription_end: FileText, test_order: TestTube2, appointment: CalendarClock, custom: Bell };
const TONE = { overdue: "bad", today: "warn", soon: "warn", upcoming: "muted" } as const;

/** The reminders as a list: what, which file (when several), when, and a link to the record. Your own reminders can be done or closed here. */
export function ReminderList({ items, lang, tz, names, canWrite = false, empty }: { items: ReminderItem[]; lang: Lang; tz: string; names?: Map<string, string>; canWrite?: boolean; empty: React.ReactNode }) {
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  if (!items.length) return <>{empty}</>;
  return (
    <ul className="reminder-list" data-testid="reminder-list">
      {items.map((i) => {
        const Icon = ICON[i.kind];
        const text = describeReminder(i, t, (code, label) => (code === "other" && label ? label : lbl(RECALL_KIND, code, lang) || label));
        return (
          <li key={i.key} className={`reminder ${i.state}`} data-kind={i.kind} data-state={i.state}>
            <span className="reminder-icon" aria-hidden="true"><Icon size={16} /></span>
            <div className="reminder-main">
              <Link href={i.href} className="reminder-text">{text}</Link>
              <div className="reminder-meta">
                {names && <span className="reminder-file">{names.get(i.patientId) ?? ""}</span>}
                <span className="ltr">{i.atTime ? fmtDateTime(i.atTime, lang, tz) : fmtDate(i.due, lang)}</span>
                {i.kind === "custom" && i.detail ? <span>{i.detail}</span> : null}
              </div>
            </div>
            <Chip tone={TONE[i.state]}>{dueText(i.days, t)}</Chip>
            {canWrite && i.kind === "custom" && (
              <span className="reminder-actions">
                <ActionForm action={reminderDone} resetOnSuccess={false}><input type="hidden" name="_pid" value={i.patientId} /><input type="hidden" name="_id" value={i.refId} />
                  <SubmitButton className="btn sm"><Check size={14} aria-hidden="true" />{t("تم", "Done")}</SubmitButton></ActionForm>
                <ActionForm action={dismissReminder} resetOnSuccess={false}><input type="hidden" name="_pid" value={i.patientId} /><input type="hidden" name="_id" value={i.refId} />
                  <SubmitButton className="btn ghost sm">{t("إغلاق", "Dismiss")}</SubmitButton></ActionForm>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
