import { Bell } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { getReminders, today } from "@/lib/care/server";
import { countByState } from "@/lib/care/reminders";
import { unavailableChannels } from "@/lib/care/channels";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { ReminderList } from "@/components/care/ReminderList";
import { addReminder, invalidateReminder } from "@/app/actions/care";

export const metadata = { title: "التذكيرات" };

export default async function PatientReminders({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  const [items, { data: own }] = await Promise.all([
    getReminders(p.id),
    createClient().from("care_reminders").select("id, title, notes, due_on, remind_days_before, repeat_months, status, completed_on, last_done_on")
      .eq("patient_id", p.id).eq("record_status", "active").order("status").order("due_on").limit(100),
  ]);
  const c = countByState(items);
  const channels = unavailableChannels().map((x) => x.label[lang]).join(t("، ", ", "));
  const day = today();
  return (
    <>
      <PageHead title={t("التذكيرات", "Reminders")}
        sub={t("ما يقترب أو تأخر في هذا الملف: الفحوص الدورية، نهاية الأدوية وإعادة صرفها، الفحوص المطلوبة، المواعيد، وما تكتبه بنفسك.", "What is coming up or late in this file: recalls, medicine end dates and refills, requested tests, appointments and what you write yourself.")} />
      <Banner tone="info">{t(`التذكيرات تظهر هنا وفي رقم الجرس أعلى الصفحة. لا يُرسَل بريد إلكتروني أو رسائل نصية (${channels}): لا توجد خدمة إرسال مربوطة.`, `Reminders show here and in the number on the bell. Nothing is sent by ${channels}: no sending service is connected.`)}</Banner>
      <div className="row">
        <Chip tone={c.overdue ? "bad" : "muted"}>{t(`متأخر: ${c.overdue}`, `Overdue: ${c.overdue}`)}</Chip>
        <Chip tone="warn">{t(`اليوم أو خلال أسبوع: ${c.today + c.soon}`, `Today or this week: ${c.today + c.soon}`)}</Chip>
        <Chip tone="muted">{t(`لاحقاً: ${c.upcoming}`, `Later: ${c.upcoming}`)}</Chip>
      </div>
      <Card title={<><Bell size={18} aria-hidden="true" /> {t("قادم ومتأخر", "Coming up and overdue")}</>}>
        <ReminderList items={items} lang={lang} tz={tz} canWrite={access.canWrite} empty={<Empty>{t("لا شيء ينتظر الآن.", "Nothing is waiting now.")}</Empty>} />
      </Card>
      {access.canWrite && (
        <Card title={t("تذكير جديد", "New reminder")}>
          <ActionForm action={addReminder} className="stack">
            <input type="hidden" name="_pid" value={p.id} />
            <div className="field"><label htmlFor="rem_title">{t("ماذا تريد أن تتذكر؟", "What to remember")} <span className="req">*</span></label><input id="rem_title" name="title" type="text" required minLength={2} maxLength={200} /></div>
            <div className="grid cols-3">
              <div className="field"><label htmlFor="rem_due">{t("التاريخ", "Date")} <span className="req">*</span></label><input id="rem_due" name="due_on" type="date" required defaultValue={day} dir="ltr" /></div>
              <div className="field"><label htmlFor="rem_lead">{t("نبّهني قبلها بـ (أيام)", "Remind me ahead (days)")}</label><input id="rem_lead" name="remind_days_before" type="number" min={0} max={365} defaultValue={3} dir="ltr" /></div>
              <div className="field"><label htmlFor="rem_rep">{t("يتكرر كل (أشهر)", "Repeat every (months)")}</label><input id="rem_rep" name="repeat_months" type="number" min={1} max={60} dir="ltr" placeholder={t("مرة واحدة", "once")} /></div>
            </div>
            <div className="field"><label htmlFor="rem_notes">{t("ملاحظات", "Notes")}</label><input id="rem_notes" name="notes" type="text" maxLength={1000} /></div>
            <SubmitButton>{t("إضافة التذكير", "Add reminder")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card title={t("تذكيراتك المكتوبة", "Reminders you wrote")}>
        {(own ?? []).length === 0 ? <Empty>{t("لم تكتب تذكيراً بعد.", "You have not written a reminder yet.")}</Empty> : (own ?? []).map((r) => (
          <article className="rec" key={r.id}>
            <div className="row between">
              <span className="row"><strong>{r.title}</strong>
                <Chip tone={r.status === "open" ? "info" : "muted"}>{r.status === "open" ? t("مفتوح", "Open") : r.status === "done" ? t("تم", "Done") : t("مغلق", "Dismissed")}</Chip>
                {r.repeat_months ? <Chip tone="muted">{t(`كل ${r.repeat_months} شهر`, `every ${r.repeat_months} mo`)}</Chip> : null}</span>
              <span className="muted small ltr">{fmtDate(r.due_on, lang)}</span>
            </div>
            {r.notes && <p className="small">{r.notes}</p>}
            {access.canWrite && (
              <details className="fold"><summary>{t("أُدخل بالخطأ", "Entered in error")}</summary>
                <div className="fold-body"><ActionForm action={invalidateReminder} className="stack"><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={r.id} />
                  <input name="reason" type="text" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} />
                  <ConfirmButton message={t("إبطال هذا التذكير؟ يبقى في السجل.", "Invalidate this reminder? It stays in the record.")}>{t("إبطال", "Invalidate")}</ConfirmButton></ActionForm></div>
              </details>
            )}
          </article>
        ))}
      </Card>
    </>
  );
}
