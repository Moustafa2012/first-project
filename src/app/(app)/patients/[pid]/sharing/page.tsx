import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";

export default async function SharingPage({ params }: { params: { pid: string } }) {
  const { t } = i18n();
  const { lang } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  if (!access.canShare) notFound();
  const { data } = await createClient().from("medical_shares")
    .select("id, title, recipient_label, scope_kind, expires_at, revoked_at, access_count, last_accessed_at, locked_until, created_at")
    .eq("patient_id", p.id).order("created_at", { ascending: false }).limit(100);
  const now = Date.now();
  const status = (s: { revoked_at: string | null; expires_at: string; locked_until: string | null }) =>
    s.revoked_at ? { tone: "muted" as const, label: t("ملغاة", "Revoked") } : Date.parse(s.expires_at) <= now ? { tone: "muted" as const, label: t("منتهية", "Expired") }
    : s.locked_until && Date.parse(s.locked_until) > now ? { tone: "warn" as const, label: t("مقفلة مؤقتاً", "Locked") } : { tone: "ok" as const, label: t("نشطة", "Active") };
  const list = data ?? [];
  return (
    <>
      <PageHead title={t("المشاركة الطبية الآمنة", "Secure medical sharing")} sub={t("أعطِ الطبيب رابطاً مع رمز PIN يفتح الجزء الذي تحدده فقط، لمدة محدودة، ويمكنك إلغاؤه فوراً.", "Give a doctor a link plus a PIN that opens only what you choose, for a limited time, revocable instantly.")}
        actions={<Link className="btn primary" href={`/patients/${p.id}/sharing/new`}><Plus size={16} aria-hidden="true" />{t("مشاركة جديدة", "New share")}</Link>} />
      <Banner tone="info">{t("الرابط وحده لا يكفي: يحتاج الطبيب الرمز أيضاً. أرسل الرمز بقناة مختلفة عن الرابط.", "The link alone is not enough: the doctor also needs the PIN. Send the PIN through a different channel than the link.")}</Banner>
      <Card title={t(`المشاركات (${list.length})`, `Shares (${list.length})`)}>
        {list.length === 0 ? <Empty>{t("لم تنشئ أي مشاركة بعد.", "You have not created any share yet.")}</Empty> : list.map((s) => {
          const st = status(s);
          return (
            <article className="rec" key={s.id}>
              <div className="row between"><span className="row"><Link href={`/patients/${p.id}/sharing/${s.id}`} className="rec-title">{s.title}</Link><Chip tone={st.tone}>{st.label}</Chip>
                <Chip tone="info">{s.scope_kind === "full" ? t("الملف الكامل", "Full file") : s.scope_kind === "specialty" ? t("تخصص", "Specialty") : t("سجلات مختارة", "Selected records")}</Chip></span>
                <span className="muted small">{t("تنتهي", "expires")} {fmtDateTime(s.expires_at, lang, tz)}</span></div>
              <div className="rec-meta">{s.recipient_label && <span>{s.recipient_label}</span>}<span>{t("مرات الفتح", "Opened")}: {s.access_count}</span>{s.last_accessed_at && <span>{t("آخر وصول", "Last access")}: {fmtDateTime(s.last_accessed_at, lang, tz)}</span>}</div>
            </article>
          );
        })}
      </Card>
    </>
  );
}
