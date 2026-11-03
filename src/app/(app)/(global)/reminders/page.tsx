import Link from "next/link";
import { Bell } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTz } from "@/lib/auth";
import { getReminders } from "@/lib/care/server";
import { countByState, groupByPatient } from "@/lib/care/reminders";
import { unavailableChannels } from "@/lib/care/channels";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { ReminderList } from "@/components/care/ReminderList";

export const metadata = { title: "التذكيرات" };

export default async function AllReminders() {
  const { lang, t } = i18n();
  const tz = getTz();
  const [items, { data: files }] = await Promise.all([getReminders(), createClient().from("patients").select("id, full_name, full_name_en")]);
  const names = new Map((files ?? []).map((f) => [f.id as string, (lang === "en" && f.full_name_en ? f.full_name_en : f.full_name) as string]));
  const groups = groupByPatient(items);
  const c = countByState(items);
  const channels = unavailableChannels().map((x) => x.label[lang]).join(t("، ", ", "));
  return (
    <>
      <PageHead title={t("مركز التذكيرات", "Reminders centre")} sub={t("كل ما يقترب أو تأخر في ملفات حسابك.", "Everything coming up or late across the files of your account.")} />
      <Banner tone="info">{t(`لا يُرسَل بريد إلكتروني أو رسائل نصية (${channels}): لا توجد خدمة إرسال مربوطة. التذكيرات تظهر هنا وعلى الجرس.`, `Nothing is sent by ${channels}: no sending service is connected. Reminders show here and on the bell.`)}</Banner>
      <div className="row">
        <Chip tone={c.overdue ? "bad" : "muted"}>{t(`متأخر: ${c.overdue}`, `Overdue: ${c.overdue}`)}</Chip>
        <Chip tone="warn">{t(`اليوم أو خلال أسبوع: ${c.today + c.soon}`, `Today or this week: ${c.today + c.soon}`)}</Chip>
        <Chip tone="muted">{t(`لاحقاً: ${c.upcoming}`, `Later: ${c.upcoming}`)}</Chip>
      </div>
      {groups.length === 0 ? <Empty>{t("لا شيء ينتظر الآن في أي ملف.", "Nothing is waiting in any file.")}</Empty> : groups.map((g) => (
        <Card key={g.patientId} title={<><Bell size={18} aria-hidden="true" /> {names.get(g.patientId) ?? ""}</>} actions={<Link className="small" href={`/patients/${g.patientId}/reminders`}>{t("تذكيرات الملف", "File reminders")}</Link>}>
          <ReminderList items={g.items} lang={lang} tz={tz} empty={null} />
        </Card>
      ))}
    </>
  );
}
