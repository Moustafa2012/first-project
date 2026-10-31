"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import { ActionForm, SubmitButton, type FormAction } from "@/components/ui/client";

/**
 * Moving a treatment (or a plan) to its next status: only the allowed statuses are offered; the date asked depends on
 * the status (the appointment, the day it was done); a surgical treatment asks for an explicit confirmation before it
 * is accepted or completed.
 */
export function TreatmentStatusForm({
  action, hidden, next, labels, surgical, lang, today, idPrefix, withDate = true,
}: {
  action: FormAction; hidden: Record<string, string>; next: string[]; labels: Record<string, string>; surgical: boolean; lang: Lang; today: string;
  idPrefix: string; withDate?: boolean;
}) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const [status, setStatus] = useState(next[0] ?? "");
  const needsConfirm = surgical && (status === "accepted" || status === "completed");
  const dateLabel = status === "scheduled" ? t("الموعد", "Appointment date") : status === "completed" ? t("تاريخ الإنجاز", "Date done") : t("التاريخ", "Date");
  if (!next.length) return null;
  return (
    <ActionForm action={action} className="stack" id={`${idPrefix}-form`}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="form-grid">
        <div className="field"><label htmlFor={`${idPrefix}-st`}>{t("الحالة الجديدة", "New status")}</label>
          <select id={`${idPrefix}-st`} name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {next.map((s) => <option key={s} value={s}>{labels[s] ?? s}</option>)}
          </select></div>
        {withDate && (status === "scheduled" || status === "completed") && (
          <div className="field"><label htmlFor={`${idPrefix}-date`}>{dateLabel}</label>
            <input id={`${idPrefix}-date`} name="date" type="date" defaultValue={status === "completed" ? today : ""} max={status === "completed" ? today : undefined}
              required={status === "scheduled"} /></div>
        )}
        <div className="field wide"><label htmlFor={`${idPrefix}-reason`}>{t("السبب / ملاحظة", "Reason / note")}</label>
          <input id={`${idPrefix}-reason`} name="reason" maxLength={500} required={status === "cancelled" || status === "deferred"} /></div>
        {needsConfirm && (
          <label className="check wide surgical-confirm"><input type="checkbox" name="confirm_surgical" required />
            {status === "accepted"
              ? t("أؤكد أن العلاج الجراحي شُرح لي (الفائدة والمخاطر والبدائل) وأوافق عليه.", "I confirm the surgical treatment was explained to me (benefits, risks, alternatives) and I agree to it.")
              : t("أؤكد أن هذا العلاج الجراحي أُجري فعلاً في التاريخ المذكور.", "I confirm this surgical treatment was actually performed on the date given.")}</label>
        )}
      </div>
      <div><SubmitButton>{t("حفظ الحالة", "Save the status")}</SubmitButton></div>
    </ActionForm>
  );
}
