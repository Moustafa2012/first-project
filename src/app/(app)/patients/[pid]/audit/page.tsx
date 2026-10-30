import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Card, Chip, Empty, PageHead } from "@/components/ui";

const ACTION: Record<string, [string, string]> = { insert: ["إضافة", "Added"], update: ["تعديل", "Changed"], invalidate: ["إبطال", "Invalidated"] };

export default async function AuditPage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  if (!access.canManage) notFound();
  const { data } = await createClient().from("audit_logs").select("id, at, actor_id, actor_kind, table_name, action, changed_fields").eq("patient_id", p.id).order("at", { ascending: false }).limit(300);
  return (
    <>
      <PageHead title={t("سجل التغييرات", "Change history")} sub={t("كل إضافة وتعديل وإبطال على الملف، لا يمكن تعديله أو حذفه.", "Every addition, change and invalidation on this file. It cannot be edited or deleted.")} />
      <Card>
        {(data ?? []).length === 0 ? <Empty>{t("لا توجد تغييرات.", "No changes.")}</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>{t("الوقت", "Time")}</th><th>{t("العملية", "Action")}</th><th>{t("الجدول", "Record type")}</th><th>{t("الحقول", "Fields")}</th><th>{t("بواسطة", "By")}</th></tr></thead>
            <tbody>{(data ?? []).map((a) => (
              <tr key={a.id}><td className="nowrap">{fmtDateTime(a.at, lang, tz)}</td><td><Chip tone={a.action === "invalidate" ? "bad" : a.action === "insert" ? "ok" : "info"}>{ACTION[a.action]?.[lang === "ar" ? 0 : 1]}</Chip></td>
                <td><span className="ltr">{a.table_name}</span></td><td className="small muted"><span className="ltr">{(a.changed_fields ?? []).slice(0, 6).join(", ")}</span></td>
                <td>{a.actor_id === access.userId ? t("أنت", "You") : a.actor_kind === "system" ? t("النظام / استيراد", "System / import") : a.actor_kind === "share_contributor" ? t("طبيب عبر رابط مشاركة", "Doctor via a share link") : t("مستخدم آخر", "Another user")}</td></tr>))}</tbody></table></div>)}
      </Card>
    </>
  );
}
