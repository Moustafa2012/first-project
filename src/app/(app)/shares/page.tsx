import Link from "next/link";
import { Download, Link2, ShieldAlert, ShieldCheck, Timer, Ban } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getTz, requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { SHARE_EVENT } from "@/lib/labels";
import { SCOPE_LABEL, SHARE_COLUMNS, STATUS_LABEL, shareStatus, type ShareListRow, type ShareStatus } from "@/lib/shares";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { ActionForm, ConfirmButton } from "@/components/ui/client";
import { revokeShare } from "@/app/actions/sharing";

export const metadata = { title: "سجل المشاركات" };

const STATUSES: ("all" | ShareStatus)[] = ["all", "active", "locked", "expired", "revoked"];

export default async function SharesRegister({ searchParams }: { searchParams: { status?: string; patient?: string; q?: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const user = await requireUser();
  const supabase = createClient();
  const [{ data: sharesData }, { data: patientsData }] = await Promise.all([
    supabase.from("medical_shares").select(SHARE_COLUMNS).order("created_at", { ascending: false }).limit(500),
    supabase.from("patients").select("id, full_name, full_name_en, mrn"),
  ]);
  const all = (sharesData ?? []) as unknown as ShareListRow[];
  const pat = new Map((patientsData ?? []).map((p) => [p.id as string, p]));
  const pname = (id: string) => { const p = pat.get(id); return p ? (lang === "en" && p.full_name_en ? p.full_name_en : p.full_name) : "—"; };
  const now = Date.now();

  const count = (s: ShareStatus) => all.filter((x) => shareStatus(x, now) === s).length;
  const statusFilter = STATUSES.includes(searchParams.status as never) ? (searchParams.status as "all" | ShareStatus) : "all";
  const patientFilter = searchParams.patient && pat.has(searchParams.patient) ? searchParams.patient : "";
  const q = (searchParams.q ?? "").trim().toLowerCase().slice(0, 80);
  const list = all.filter((s) =>
    (statusFilter === "all" || shareStatus(s, now) === statusFilter) && (!patientFilter || s.patient_id === patientFilter) &&
    (!q || s.title.toLowerCase().includes(q) || (s.recipient_label ?? "").toLowerCase().includes(q) || (s.token_hint ?? "").toLowerCase() === q));

  const ids = all.map((s) => s.id);
  const { data: events } = ids.length ? await supabase.from("medical_share_access_logs").select("id, share_id, event, at, user_agent").in("share_id", ids.slice(0, 500)).order("at", { ascending: false }).limit(60) : { data: [] };
  const byId = new Map(all.map((s) => [s.id, s]));
  const failed = all.reduce((n, s) => n + s.failed_attempts, 0);
  const opens = all.reduce((n, s) => n + s.access_count, 0);

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(statusFilter !== "all" ? { status: statusFilter } : {}), ...(patientFilter ? { patient: patientFilter } : {}), ...(q ? { q } : {}), ...over });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "status" && v === "all")) p.delete(k);
    const s = p.toString();
    return s ? `/shares?${s}` : "/shares";
  };

  return (
    <>
      <PageHead title={t("سجل المشاركات", "Share register")}
        sub={t("كل الروابط والرموز التي أنشأتها لكل ملفاتك: حالتها ومن فتحها ومتى، مع إمكانية الإلغاء الفوري.", "Every link and PIN you created across all your files: status, who opened it and when, with instant revocation.")}
        actions={<a className="btn" href={`/api/shares/export${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`}><Download size={16} aria-hidden="true" />{t("تصدير CSV", "Export CSV")}</a>} />

      <div className="grid cols-4" style={{ marginBlockEnd: "1rem" }}>
        <div className="tile"><div className="k"><ShieldCheck size={14} aria-hidden="true" /> {t("نشطة", "Active")}</div><div className="v">{count("active")}</div></div>
        <div className="tile"><div className="k"><Timer size={14} aria-hidden="true" /> {t("منتهية / مقفلة", "Expired / locked")}</div><div className="v">{count("expired") + count("locked")}</div></div>
        <div className="tile"><div className="k"><Ban size={14} aria-hidden="true" /> {t("ملغاة", "Revoked")}</div><div className="v">{count("revoked")}</div></div>
        <div className="tile"><div className="k"><ShieldAlert size={14} aria-hidden="true" /> {t("مرات الفتح · PIN خاطئ", "Opens · wrong PINs")}</div><div className="v">{opens} · {failed}</div></div>
      </div>
      {failed > 0 && <Banner tone="warn">{t("سُجّلت محاولات PIN خاطئة. إن لم تتوقعها فألغِ الرابط المعني وأنشئ غيره.", "Wrong PIN attempts were recorded. If you did not expect them, revoke the link concerned and create a new one.")}</Banner>}

      <Card title={t(`المشاركات (${list.length})`, `Shares (${list.length})`)}>
        <nav className="tabs" aria-label={t("تصفية الحالة", "Filter by status")} style={{ marginBlockEnd: ".75rem" }}>
          {STATUSES.map((s) => <Link key={s} href={href({ status: s })} aria-current={statusFilter === s ? "true" : undefined}>{s === "all" ? t("الكل", "All") : STATUS_LABEL[s][lang]}{s !== "all" ? ` (${count(s)})` : ` (${all.length})`}</Link>)}
        </nav>
        <form method="get" className="row" style={{ marginBlockEnd: ".75rem" }}>
          {statusFilter !== "all" && <input type="hidden" name="status" value={statusFilter} />}
          <select name="patient" defaultValue={patientFilter} aria-label={t("الملف", "File")} style={{ width: "auto", minWidth: 180 }}>
            <option value="">{t("كل الملفات", "All files")}</option>{[...pat.values()].map((p) => <option key={p.id as string} value={p.id as string}>{lang === "en" && p.full_name_en ? p.full_name_en : p.full_name}</option>)}
          </select>
          <input type="search" name="q" defaultValue={q} placeholder={t("بحث بالغرض أو المستلم أو آخر 4 من الرمز", "Search purpose, recipient or token ending")} aria-label={t("بحث", "Search")} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn">{t("تصفية", "Filter")}</button>
        </form>

        {list.length === 0 ? <Empty>{all.length === 0 ? t("لم تنشئ أي مشاركة بعد.", "You have not created any share yet.") : t("لا نتائج بهذه التصفية.", "Nothing matches these filters.")}</Empty> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr>
                <th>{t("الغرض / المستلم", "Purpose / recipient")}</th><th>{t("الملف", "File")}</th><th>{t("الرمز", "Token")}</th><th>{t("الحالة", "Status")}</th>
                <th>{t("أُنشئت", "Created")}</th><th>{t("تنتهي", "Expires")}</th><th>{t("الاستخدام", "Usage")}</th><th><span className="sr-only">{t("إجراءات", "Actions")}</span></th>
              </tr></thead>
              <tbody>
                {list.map((s) => {
                  const st = shareStatus(s, now);
                  return (
                    <tr key={s.id}>
                      <td><Link href={`/patients/${s.patient_id}/sharing/${s.id}`}><strong>{s.title}</strong></Link>{s.recipient_label && <div className="small muted">{s.recipient_label}</div>}
                        <div className="small"><Chip tone="info">{SCOPE_LABEL[s.scope_kind]?.[lang] ?? s.scope_kind}</Chip></div></td>
                      <td>{pname(s.patient_id)}<div className="small muted"><span className="ltr">{pat.get(s.patient_id)?.mrn as string}</span></div></td>
                      <td><span className="ltr">{s.token_hint ? `…${s.token_hint}` : "—"}</span><div className="small muted">{s.created_by === user.id ? t("أنشأتها أنت", "created by you") : t("عضو آخر", "another member")}</div></td>
                      <td><Chip tone={STATUS_LABEL[st].tone}>{STATUS_LABEL[st][lang]}</Chip>
                        {st === "revoked" && s.revoke_reason && <div className="small muted">{s.revoke_reason === "auto_revoked_too_many_failed_pins" ? t("تلقائياً: PIN خاطئ متكرر", "auto: repeated wrong PINs") : s.revoke_reason === "patient_file_deleted" ? t("حذف الملف", "file deleted") : s.revoke_reason}</div>}</td>
                      <td className="nowrap small">{fmtDateTime(s.created_at, lang, tz)}</td>
                      <td className="nowrap small">{fmtDateTime(s.revoked_at ?? s.expires_at, lang, tz)}</td>
                      <td className="small">{t("فُتحت", "Opened")}: <strong>{s.access_count}</strong>{s.last_accessed_at && <div className="muted">{fmtDateTime(s.last_accessed_at, lang, tz)}</div>}
                        {(s.failed_attempts > 0 || s.lock_count > 0) && <div><Chip tone="warn">{t(`PIN خاطئ ${s.failed_attempts} · قفل ${s.lock_count}`, `${s.failed_attempts} wrong PIN · ${s.lock_count} locks`)}</Chip></div>}</td>
                      <td>
                        {(st === "active" || st === "locked") && (
                          <ActionForm action={revokeShare} className="row" resetOnSuccess={false}>
                            <input type="hidden" name="_pid" value={s.patient_id} /><input type="hidden" name="_id" value={s.id} />
                            <ConfirmButton message={t("إلغاء هذه المشاركة فوراً؟", "Revoke this share immediately?")} className="btn danger sm">{t("إلغاء", "Revoke")}</ConfirmButton>
                          </ActionForm>)}
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>)}
        <p className="small muted" style={{ marginBlockStart: ".6rem" }}>{t("لا يُحفظ الرابط ولا الـ PIN بصيغة مقروءة؛ يظهر فقط آخر 4 أحرف من الرمز لتمييز الروابط.", "The link and PIN are never stored in readable form; only the last 4 characters of the token are shown so links can be told apart.")}</p>
      </Card>

      <Card title={t("آخر النشاطات على كل المشاركات", "Latest activity across all shares")}>
        {(events ?? []).length === 0 ? <Empty>{t("لا نشاط بعد.", "No activity yet.")}</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>{t("الوقت", "Time")}</th><th>{t("الحدث", "Event")}</th><th>{t("المشاركة", "Share")}</th><th>{t("الملف", "File")}</th><th>{t("المتصفح", "Browser")}</th></tr></thead>
            <tbody>{(events ?? []).map((e) => { const s = byId.get(e.share_id as string); const bad = ["pin_failed", "locked", "locked_attempt", "blocked", "auto_revoked"].includes(e.event as string);
              return (<tr key={e.id as number}><td className="nowrap small">{fmtDateTime(e.at as string, lang, tz)}</td><td>{bad ? <Chip tone="warn">{SHARE_EVENT[e.event as string]?.[lang] ?? e.event}</Chip> : (SHARE_EVENT[e.event as string]?.[lang] ?? e.event)}</td>
                <td>{s ? <Link href={`/patients/${s.patient_id}/sharing/${s.id}`}>{s.title}</Link> : "—"}{s?.token_hint && <span className="muted small"> <span className="ltr">…{s.token_hint}</span></span>}</td><td>{s ? pname(s.patient_id) : "—"}</td><td className="small muted">{e.user_agent ? String(e.user_agent).slice(0, 48) : ""}</td></tr>); })}</tbody></table></div>)}
        <p className="small muted" style={{ marginBlockStart: ".5rem" }}><Link2 size={12} aria-hidden="true" /> {t("عنوان الاتصال لا يُعرض هنا؛ يُحفظ مُجزَّأً فقط في تفاصيل كل مشاركة.", "Connection addresses are not shown here; they are stored only as salted hashes in each share's detail page.")}</p>
      </Card>
    </>
  );
}
