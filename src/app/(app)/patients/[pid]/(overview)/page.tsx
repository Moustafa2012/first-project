import Link from "next/link";
import { appliesToSex, forSex } from "@/lib/sex";
import { CalendarClock, ClipboardList, Link2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getObsTypes, getPatient, getSpecialties } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { CLINICAL_STATUS, ENCOUNTER_KIND, lbl, MED_STATUS } from "@/lib/labels";
import type { ObservationRow } from "@/lib/types";
import { Banner, Card, Chip, Empty, InterpChip } from "@/components/ui";
import { SpecialtyIcon } from "@/components/Icon";
import { valueText } from "@/components/observations/ObservationTable";
import { DerivedCard } from "@/components/observations/DerivedCard";
import { ClinicalContext } from "@/components/ClinicalContext";
import { getClinicalContext } from "@/lib/clinical-context-server";

const HIGHLIGHT = ["blood_pressure", "blood_glucose", "heart_rate", "weight", "spo2", "body_temperature"];

export default async function PatientDashboard({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const [access, types, specs] = await Promise.all([getAccess(p.id), getObsTypes(), getSpecialties()]);
  const supabase = createClient();
  const base = `/patients/${p.id}`;
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const active = { patient_id: p.id, record_status: "active" };

  const [ctx, vit, flagged, appts, visits, orders, shares, notes, docsNoDate, suggested, ctrs] = await Promise.all([
    getClinicalContext(p.id),
    supabase.from("observations").select("*").eq("patient_id", p.id).in("status", ["final", "preliminary"]).in("type_id", types.filter((x) => HIGHLIGHT.includes(x.code)).map((x) => x.id)).order("effective_at", { ascending: false }).limit(300),
    supabase.from("observations").select("*").eq("patient_id", p.id).eq("status", "final").gte("effective_at", since).not("interpretation", "in", "(normal,not_assessed)").order("effective_at", { ascending: false }).limit(8),
    supabase.from("appointments").select("id, scheduled_at, reason, practitioner_name, specialty_id").match(active).eq("status", "scheduled").gte("scheduled_at", now).order("scheduled_at").limit(5),
    supabase.from("encounters").select("id, kind, reason, started_at, specialty_id").match(active).order("started_at", { ascending: false }).limit(3),
    supabase.from("test_orders").select("id", { count: "exact", head: true }).match(active).eq("status", "requested"),
    access.canShare ? supabase.from("medical_shares").select("id, title, expires_at").eq("patient_id", p.id).is("revoked_at", null).gt("expires_at", now) : Promise.resolve({ data: [] as { id: string; title: string; expires_at: string }[] }),
    access.canShare ? supabase.from("share_notes").select("id", { count: "exact", head: true }).eq("patient_id", p.id).is("reviewed_at", null) : Promise.resolve({ count: 0 }),
    supabase.from("medical_documents").select("id", { count: "exact", head: true }).match(active).is("document_date", null),
    supabase.from("test_orders").select("id", { count: "exact", head: true }).match(active).eq("status", "suggested"),
    supabase.from("share_contributors").select("id, share_id, full_name, contribution_count, last_contribution_at, reviewed_at").eq("patient_id", p.id).gt("contribution_count", 0),
  ]);
  const unreviewed = ((ctrs.data ?? []) as { share_id: string; full_name: string; last_contribution_at: string | null; reviewed_at: string | null }[])
    .filter((c) => !c.reviewed_at || (c.last_contribution_at != null && c.last_contribution_at > c.reviewed_at));

  const byType = new Map<string, ObservationRow>();
  for (const o of (vit.data ?? []) as ObservationRow[]) if (!byType.has(o.type_id)) byType.set(o.type_id, o);
  const tOf = new Map(types.map((x) => [x.id, x]));
  const alerts: string[] = [];
  if ((notes as { count: number | null }).count) alerts.push(t(`${(notes as { count: number }).count} ملاحظة من طبيب بانتظار مراجعتك.`, `${(notes as { count: number }).count} doctor note(s) waiting for your review.`));
  if (docsNoDate.count) alerts.push(t(`${docsNoDate.count} مستند بلا تاريخ.`, `${docsNoDate.count} document(s) without a date.`));
  if (orders.count) alerts.push(t(`${orders.count} فحص طلبه طبيب ولم يُنجز.`, `${orders.count} test(s) ordered by a clinician not done yet.`));
  for (const c of unreviewed.slice(0, 3)) alerts.push(t(`أضاف ${c.full_name} بيانات إلى ملفك عبر رابط مشاركة — راجعها من صفحة المشاركة.`, `${c.full_name} added to your file through a share link — review it on the share page.`));
  if (suggested.count) alerts.push(t(`${suggested.count} فحص مقترح بانتظار قرار الطبيب.`, `${suggested.count} suggested test(s) awaiting a clinician’s decision.`));
  const activeShares = (shares.data ?? []) as { id: string; title: string; expires_at: string }[];

  return (
    <>
      {alerts.length > 0 && <Banner tone="info" title={t("للانتباه", "Needs attention")}><ul style={{ margin: 0, paddingInlineStart: "1.1rem" }}>{alerts.map((a) => <li key={a}>{a}</li>)}</ul></Banner>}

      <div className="grid cols-3">
        {HIGHLIGHT.map((code) => {
          const ty = types.find((x) => x.code === code);
          const o = ty ? byType.get(ty.id) : undefined;
          if (!ty) return null;
          return (
            <Link key={code} href={`${base}/vitals?type=${code}`} className="tile" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="k">{lang === "ar" ? ty.name_ar : ty.name_en}</div>
              {o ? (<>
                <div className="v"><span className="ltr">{valueText(o, ty)}</span><span className="u">{o.unit}</span></div>
                <div className="row" style={{ gap: ".4rem" }}><InterpChip value={o.interpretation} lang={lang} /><span className="muted small">{fmtDate(o.effective_at, lang, tz)}</span></div>
              </>) : <div className="muted small" style={{ marginBlockStart: ".4rem" }}>{t("لا توجد قراءات", "No readings yet")}</div>}
            </Link>
          );
        })}
      </div>

      <DerivedCard pid={p.id} compact />

      <ClinicalContext ctx={ctx} lang={lang} tz={tz} coreHref={`${base}/profile`} />

      <Card title={t("نتائج حديثة خارج المجال (آخر 30 يوماً)", "Recent out-of-range results (last 30 days)")} actions={<Link href={`${base}/labs`} className="small">{t("التحاليل", "Labs")}</Link>}>
        {(flagged.data ?? []).length === 0 ? <Empty>{t("لا توجد نتائج مُعلَّمة.", "No flagged results.")}</Empty> : (
          <div className="stack">{((flagged.data ?? []) as ObservationRow[]).map((o) => {
            const ty = tOf.get(o.type_id);
            return (<div key={o.id} className="row between"><span>{ty ? (lang === "ar" ? ty.name_ar : ty.name_en) : ""}: <strong className="ltr">{valueText(o, ty)} {o.unit}</strong></span><span className="row"><InterpChip value={o.interpretation} lang={lang} /><span className="muted small">{fmtDate(o.effective_at, lang, tz)}</span></span></div>);
          })}</div>)}
        <p className="small muted" style={{ marginBlockStart: ".6rem" }}>{t("مؤشرات تستدعي تقييم مختص وليست تشخيصاً.", "Prompts for professional assessment, not a diagnosis.")}</p>
      </Card>

      <div className="grid cols-2">
        <Card title={<><CalendarClock size={18} aria-hidden="true" /> {t("المواعيد القادمة", "Upcoming appointments")}</>} actions={<Link href={`${base}/appointments`} className="small">{t("الكل", "All")}</Link>}>
          {(appts.data ?? []).length === 0 ? <Empty>{t("لا مواعيد قادمة.", "No upcoming appointments.")}</Empty> : (appts.data ?? []).map((a) => (
            <div key={a.id} className="row between"><span>{a.reason ?? "—"}{a.practitioner_name ? ` — ${a.practitioner_name}` : ""}</span><span className="muted small">{fmtDateTime(a.scheduled_at, lang, tz)}</span></div>))}
        </Card>
        <Card title={<><ClipboardList size={18} aria-hidden="true" /> {t("آخر الزيارات", "Latest visits")}</>} actions={<Link href={`${base}/visits`} className="small">{t("الكل", "All")}</Link>}>
          {(visits.data ?? []).length === 0 ? <Empty>{t("لا زيارات مسجلة.", "No visits recorded.")}</Empty> : (visits.data ?? []).map((v) => (
            <div key={v.id} className="row between"><Link href={`${base}/visits/${v.id}`}>{lbl(ENCOUNTER_KIND, v.kind, lang)}{v.reason ? ` — ${v.reason}` : ""}</Link><span className="muted small">{fmtDate(v.started_at, lang, tz)}</span></div>))}
        </Card>
      </div>

      {access.canShare && (
        <Card title={<><Link2 size={18} aria-hidden="true" /> {t("المشاركات النشطة", "Active shares")}</>} actions={<Link href={`${base}/sharing/new`} className="btn sm primary">{t("مشاركة جديدة", "New share")}</Link>}>
          {activeShares.length === 0 ? <Empty>{t("لا توجد مشاركات نشطة. أنشئ مشاركة قبل زيارة طبيب جديد.", "No active shares. Create one before seeing a new doctor.")}</Empty> : activeShares.map((s) => (
            <div key={s.id} className="row between"><Link href={`${base}/sharing/${s.id}`}>{s.title}</Link><span className="muted small">{t("تنتهي", "expires")} {fmtDateTime(s.expires_at, lang, tz)}</span></div>))}
        </Card>
      )}

      <Card title={t("الأقسام الطبية", "Specialty files")} actions={<Link href={`${base}/specialties`} className="small">{t("الكل", "All")}</Link>}>
        <div className="grid cols-4">
          {forSex(specs, p.sex).filter((s) => s.kind === "clinical").slice(0, 12).map((s) => (
            <Link key={s.id} href={`${base}/specialties/${s.code}`} className="row" style={{ textDecoration: "none", color: "inherit" }}>
              <SpecialtyIcon name={s.icon} /><span>{lang === "ar" ? s.name_ar : s.name_en}</span>
            </Link>))}
        </div>
      </Card>
    </>
  );
}
