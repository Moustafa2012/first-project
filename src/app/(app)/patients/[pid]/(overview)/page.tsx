import Link from "next/link";
import { appliesToSex, forSex } from "@/lib/sex";
import { CalendarClock, ClipboardList, Link2, Thermometer } from "lucide-react";
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
import { pendingFollowUps, type Recall } from "@/lib/followups";
import { PendingList } from "@/components/dental/FollowUps";
import { RECALL_KIND } from "@/lib/labels";
import { describeReminder } from "@/lib/care/reminders";
import { localDate } from "@/lib/format";
import { getAbnormalLabs, getAttention, getReminders } from "@/lib/care/server";
import { buildAttention, labTrend } from "@/lib/care/attention";
import { ArrowDown, ArrowUp, Minus, TriangleAlert } from "lucide-react";
import { leaveFile } from "@/app/actions/care";
import { ActionForm, ConfirmButton } from "@/components/ui/client";

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

  const [ctx, vit, flagged, appts, visits, orders, shares, notes, docsNoDate, suggested, ctrs, symptoms] = await Promise.all([
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
    supabase.from("symptom_entries").select("id, symptom, severity, onset_at").match(active).is("ended_at", null).order("onset_at", { ascending: false }).limit(5),
  ]);
  const unreviewed = ((ctrs.data ?? []) as { share_id: string; full_name: string; last_contribution_at: string | null; reviewed_at: string | null }[])
    .filter((c) => !c.reviewed_at || (c.last_contribution_at != null && c.last_contribution_at > c.reviewed_at));

  const byType = new Map<string, ObservationRow>();
  for (const o of (vit.data ?? []) as ObservationRow[]) if (!byType.has(o.type_id)) byType.set(o.type_id, o);
  const tOf = new Map(types.map((x) => [x.id, x]));
  const activeShares = (shares.data ?? []) as { id: string; title: string; expires_at: string }[];

  // what is waiting, across the file: due recalls, open treatments, follow-ups asked at a visit
  const today = localDate(new Date(), tz);
  const [{ data: rc }, { data: fv }, { data: ti }, abnormal, attRows, reminders, perioDrafts, noteDrafts] = await Promise.all([
    supabase.from("recalls").select("id, kind, label, interval_months, due_on, last_done_on, status").match(active).eq("status", "active").order("due_on"),
    supabase.from("encounters").select("id, started_at, follow_up_date, reason, specialty_id").match(active).order("started_at", { ascending: false }).limit(100),
    supabase.from("treatment_items").select("id, name, status, scheduled_for, teeth").match(active).in("status", ["accepted", "scheduled", "in_progress"]).limit(50),
    getAbnormalLabs(p.id), getAttention(), getReminders(p.id),
    supabase.from("perio_exams").select("id", { count: "exact", head: true }).match(active).eq("status", "draft"),
    supabase.from("clinical_notes").select("id", { count: "exact", head: true }).match(active).eq("status", "draft"),
  ]);
  const mine = attRows.filter((r) => r.patient_id === p.id);
  const hoursLeft = (iso: string) => (Date.parse(iso) - Date.now()) / 3_600_000;
  const pending = pendingFollowUps({
    today, base, recalls: (rc ?? []) as Recall[],
    items: (ti ?? []) as { id: string; name: string; status: string; scheduled_for: string | null; teeth: number[] | null }[],
    visits: (fv ?? []) as { id: string; started_at: string; follow_up_date: string | null; reason: string | null; specialty_id: string | null }[],
    label: { recall: (r) => (r.kind === "other" ? r.label ?? "" : lbl(RECALL_KIND, r.kind, lang)), acceptedNotScheduled: t("علاج موافَق عليه ولم يُجدول", "Accepted treatment, not scheduled"),
      inProgress: t("علاج قيد التنفيذ", "Treatment in progress"), visitFollowUp: t("متابعة طلبتها زيارة", "Follow-up asked at a visit"), appointment: t("موعد", "Appointment"),
      appointmentPast: t("موعد مضى", "Past appointment") },
  }).filter((f) => f.state !== "upcoming");

  const attention = buildAttention({
    base, overdue: reminders.filter((r) => r.state === "overdue").map((r) => ({ label: describeReminder(r, t, (code, label) => (code === "other" && label ? label : lbl(RECALL_KIND, code, lang) || label)), days: -r.days, href: r.href })),
    unreviewed: { notes: (notes as { count: number | null }).count ?? 0, clinicians: unreviewed.map((c) => c.full_name) },
    softTissue: mine.some((r) => r.code === "soft_tissue"),
    shares: activeShares.filter((s) => hoursLeft(s.expires_at) <= 72).map((s) => ({ id: s.id, title: s.title, hoursLeft: hoursLeft(s.expires_at) })),
    drafts: { perio: perioDrafts.count ?? 0, notes: noteDrafts.count ?? 0 },
    documentsNoDate: docsNoDate.count ?? 0, ordersOpen: orders.count ?? 0, suggested: suggested.count ?? 0,
  }, t);

  return (
    <>
      {(attention.length > 0 || abnormal.length > 0) && (
        <Card id="attention" title={<><TriangleAlert size={18} aria-hidden="true" /> {t("يحتاج انتباهك", "Needs your attention")}</>}
          description={t("مؤشرات تستدعي المراجعة وليست تشخيصاً.", "Prompts for a review, not a diagnosis.")}>
          {abnormal.length > 0 && (
            <div className="attention-labs" data-testid="attention-labs">
              <p className="small muted" style={{ margin: 0 }}>{t("آخر قيمة لكل تحليل خارج المجال المرجعي، مع المقارنة بالقيمة السابقة", "Latest value of each test outside its reference, compared with the value before")}</p>
              {abnormal.map((l) => {
                const ty = tOf.get(l.type_id);
                const tr = labTrend(l);
                const name = l.custom_name || (ty ? (lang === "ar" ? ty.name_ar : ty.name_en) : "");
                const Arrow = tr.dir === "up" ? ArrowUp : tr.dir === "down" ? ArrowDown : Minus;
                const val = l.value_num != null ? String(l.value_num) : l.value_text ?? "";
                return (
                  <div key={l.observation_id} className="row between attention-lab" data-testid="attention-lab">
                    <span><Link href={`${base}/labs?view=trends&type=${ty?.code ?? ""}`}>{name}</Link>: <strong className="ltr">{val} {l.unit ?? ""}</strong></span>
                    <span className="row">
                      <InterpChip value={l.interpretation} lang={lang} />
                      {tr.dir !== "none" ? (
                        <Chip tone={tr.verdict === "worsening" ? "bad" : tr.verdict === "improving" ? "ok" : "muted"} title={t("مقارنة بالقيمة السابقة", "Against the previous value")}>
                          <Arrow size={13} aria-hidden="true" />{tr.dir === "flat" ? t("ثابت", "steady") : <span className="ltr">{tr.delta != null && tr.delta > 0 ? "+" : ""}{tr.delta}</span>}
                          {tr.verdict === "worsening" ? ` · ${t("يبتعد عن المجال", "further out")}` : tr.verdict === "improving" ? ` · ${t("يقترب من المجال", "closer to range")}` : ""}
                        </Chip>
                      ) : <span className="muted small">{l.prev_value != null ? t("وحدة مختلفة عن السابقة", "unit differs from the previous") : t("أول قيمة", "first value")}</span>}
                      <span className="muted small">{fmtDate(l.effective_at, lang, tz)}</span>
                    </span>
                  </div>
                );
              })}
              <Link href={`${base}/labs?view=compare`} className="small">{t("قارن بين تقريرين", "Compare two reports")}</Link>
            </div>
          )}
          {attention.length > 0 && (
            <ul className="attention-list" data-testid="attention-list">{attention.map((a) => (
              <li key={a.key} className={`attention-${a.tone}`}><Link href={a.href}>{a.text}</Link></li>))}</ul>
          )}
        </Card>
      )}

      {pending.length > 0 && (
        <Card title={<><CalendarClock size={18} aria-hidden="true" /> {t("المتابعات المعلّقة", "Pending follow-ups")}</>} id="pending">
          <PendingList items={pending.slice(0, 8)} lang={lang} />
        </Card>
      )}

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

      {(symptoms.data ?? []).length > 0 && (
        <Card title={<><Thermometer size={18} aria-hidden="true" /> {t("أعراض مستمرة", "Ongoing symptoms")}</>} actions={<Link href={`${base}/symptoms`} className="small">{t("سجل الأعراض", "Symptom log")}</Link>}>
          {(symptoms.data ?? []).map((y) => (
            <div key={y.id} className="row between"><span>{y.symptom}{y.severity != null ? <span className="muted small"> · {t("الشدة", "severity")} <span className="ltr">{y.severity}/10</span></span> : null}</span><span className="muted small">{fmtDate(y.onset_at, lang, tz)}</span></div>))}
        </Card>
      )}

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

      {access.role === "caregiver" && (
        <Card title={t("عضويتك في هذا الملف", "Your membership of this file")}>
          <p className="small">{access.canWrite ? t("أنت محرّر: تقرأ وتُدخل سجلات.", "You are an editor: you read and add records.") : t("أنت مشاهد: تقرأ فقط.", "You are a viewer: you read only.")}</p>
          <ActionForm action={leaveFile} resetOnSuccess={false}><input type="hidden" name="_pid" value={p.id} />
            <ConfirmButton message={t("مغادرة هذا الملف؟ لن تستطيع فتحه إلا بدعوة جديدة.", "Leave this file? You will need a new invitation to open it again.")}>{t("مغادرة الملف", "Leave this file")}</ConfirmButton></ActionForm>
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
