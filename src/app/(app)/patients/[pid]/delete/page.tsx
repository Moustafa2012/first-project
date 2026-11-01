import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveRestore, Download, ShieldAlert, Trash2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Banner, Card, PageHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { deleteNow, requestDeletion, restoreFile } from "@/app/actions/deletion";

export const metadata = { title: "حذف الملف الطبي" };

export default async function DeletePage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  if (!access.canManage) notFound();
  const name = lang === "en" && p.full_name_en ? p.full_name_en : p.full_name;
  const pending = Boolean(p.deletion_requested_at);
  const daysLeft = p.deletion_scheduled_for ? Math.max(0, Math.ceil((Date.parse(p.deletion_scheduled_for) - Date.now()) / 86_400_000)) : 0;

  if (pending) {
    return (
      <>
        <PageHead title={t("الملف مجدول للحذف", "This file is scheduled for deletion")} sub={name} />
        <Banner tone="warn" title={t(`سيُحذف نهائياً خلال ${daysLeft} يوماً`, `It will be permanently deleted in ${daysLeft} day(s)`)}>
          {t("بتاريخ", "on")} {p.deletion_scheduled_for ? fmtDateTime(p.deletion_scheduled_for, lang, tz) : ""}. {t("الملف الآن للقراءة فقط وقد أُلغيت كل روابط المشاركة.", "The file is read-only now and every sharing link was revoked.")}
        </Banner>
        <div className="grid cols-2" style={{ marginBlockStart: "1rem" }}>
          <Card title={t("استعادة الملف", "Restore the file")}>
            <p className="muted">{t("إن غيّرت رأيك يمكنك إلغاء الحذف الآن، ويعود الملف كما كان. الروابط التي أُلغيت لا تعود؛ أنشئ روابط جديدة عند الحاجة.", "If you changed your mind, cancel the deletion and the file returns as it was. Revoked links do not come back; create new ones when needed.")}</p>
            <ActionForm action={restoreFile} className="stack" resetOnSuccess={false}><input type="hidden" name="_pid" value={p.id} /><div><SubmitButton pending={t("جارٍ الاستعادة…", "Restoring…")}><ArchiveRestore size={16} aria-hidden="true" />{t("استعادة الملف", "Restore this file")}</SubmitButton></div></ActionForm>
            <hr />
            <p className="small muted">{t("قبل الحذف النهائي يمكنك تنزيل بياناتك:", "Before it is erased you can download your data:")}</p>
            <a className="btn sm" href={`/api/patients/${p.id}/report?scope=full&dl=1`}><Download size={14} aria-hidden="true" />{t("تنزيل التقرير الكامل (PDF)", "Download the complete report (PDF)")}</a>
            <a className="btn sm" href={`/api/patients/${p.id}/export`} download style={{ marginInlineStart: ".4rem" }}><Download size={14} aria-hidden="true" />{t("تصدير كل البيانات (ZIP + JSON/FHIR)", "Export all data (ZIP + JSON/FHIR)")}</a>
          </Card>
          <Card title={t("حذف نهائي الآن", "Delete permanently now")}>
            <p className="muted">{t("لا تنتظر المدة المتبقية. لا يمكن التراجع بعد التنفيذ.", "Do not wait for the remaining period. This cannot be undone.")}</p>
            <ActionForm action={deleteNow} className="stack" resetOnSuccess={false}>
              <input type="hidden" name="_pid" value={p.id} />
              <div className="field"><label htmlFor="confirm">{t("اكتب اسم الملف للتأكيد:", "Type the file name to confirm:")} <strong>{p.full_name}</strong></label><input id="confirm" name="confirm" type="text" autoComplete="off" required /></div>
              <div className="field"><label htmlFor="password">{t("كلمة المرور", "Your password")}</label><input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" /></div>
              <div><SubmitButton className="btn danger" pending={t("جارٍ الحذف…", "Deleting…")}><Trash2 size={16} aria-hidden="true" />{t("حذف نهائي الآن", "Delete permanently now")}</SubmitButton></div>
            </ActionForm>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title={t("حذف الملف الطبي", "Delete this health file")} sub={name} />
      <Banner tone="bad" title={t("إجراء حسّاس", "Sensitive action")}>{t("اقرأ ما سيحدث قبل المتابعة.", "Read what will happen before you continue.")}</Banner>
      <div className="grid cols-2" style={{ marginBlockStart: "1rem" }}>
        <Card title={t("ماذا سيحدث؟", "What happens?")}>
          <ol className="stack" style={{ paddingInlineStart: "1.2rem", margin: 0 }}>
            <li>{t("يصبح الملف للقراءة فقط فوراً، وتُلغى جميع روابط المشاركة النشطة.", "The file becomes read-only immediately and every active sharing link is revoked.")}</li>
            <li>{t("يُحتفظ به 30 يوماً ويمكنك استعادته في أي وقت خلالها.", "It is kept for 30 days and you can restore it at any time.")}</li>
            <li>{t("بعد ذلك يُحذف نهائياً: كل السجلات والمستندات والقياسات والتحاليل وسجل التغييرات. لا يمكن استرجاعها.", "After that it is permanently erased: all records, documents, measurements, labs and the change history. This cannot be undone.")}</li>
            <li>{t("يفقد كل من يملك صلاحية على الملف وصوله إليه.", "Everyone who had access to this file loses it.")}</li>
          </ol>
          <hr />
          <a className="btn sm" href={`/api/patients/${p.id}/report?scope=full&dl=1`}><Download size={14} aria-hidden="true" />{t("نزّل تقريرك الكامل أولاً (PDF)", "Download your complete report first (PDF)")}</a>
          <a className="btn sm" href={`/api/patients/${p.id}/export`} download style={{ marginInlineStart: ".4rem" }}><Download size={14} aria-hidden="true" />{t("أو صدّر كل بياناتك (ZIP)", "Or export all your data (ZIP)")}</a>
        </Card>
        <Card title={t("تأكيد الحذف", "Confirm deletion")}>
          <ActionForm action={requestDeletion} className="stack" resetOnSuccess={false}>
            <input type="hidden" name="_pid" value={p.id} />
            <div className="field"><label htmlFor="confirm">{t("اكتب اسم الملف للتأكيد:", "Type the file name to confirm:")} <strong>{p.full_name}</strong></label><input id="confirm" name="confirm" type="text" autoComplete="off" required /></div>
            <div className="field"><label htmlFor="password">{t("كلمة المرور", "Your password")}</label><input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" /></div>
            <label className="check"><input type="checkbox" name="ack" required />{t("أفهم أن الحذف سيصبح نهائياً بعد 30 يوماً.", "I understand the deletion becomes permanent after 30 days.")}</label>
            <div className="row">
              <SubmitButton className="btn danger" pending={t("جارٍ الجدولة…", "Scheduling…")}><ShieldAlert size={16} aria-hidden="true" />{t("جدولة حذف الملف", "Schedule deletion")}</SubmitButton>
              <Link className="btn" href={`/patients/${p.id}/profile`}>{t("إلغاء", "Cancel")}</Link>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
