import Link from "next/link";
import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient, getSpecialties, UUID_RE } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { SHARE_EVENT, SHARE_MODULES } from "@/lib/labels";
import { Banner, Card, Chip, Empty, KV, PageHead } from "@/components/ui";
import { ActionForm, ConfirmButton } from "@/components/ui/client";
import { markNoteReviewed, revokeShare } from "@/app/actions/sharing";

export default async function ShareDetail({ params }: { params: { pid: string; id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  if (!access.canShare) notFound();
  const supabase = createClient();
  const { data: s } = await supabase.from("medical_shares").select("id, title, recipient_label, scope_kind, specialty_ids, include, include_sensitive, date_from, date_to, allow_download, allow_print, allow_notes, max_attempts, failed_attempts, lock_count, locked_until, expires_at, revoked_at, revoke_reason, last_accessed_at, access_count, created_at").eq("id", params.id).eq("patient_id", p.id).maybeSingle();
  if (!s) notFound();
  const [specs, { data: logs }, { data: notes }, { count: itemCount }] = await Promise.all([
    getSpecialties(),
    supabase.from("medical_share_access_logs").select("id, event, ip_hash, user_agent, at, detail").eq("share_id", s.id).order("at", { ascending: false }).limit(200),
    supabase.from("share_notes").select("id, author_name, body, created_at, reviewed_at").eq("share_id", s.id).order("created_at", { ascending: false }),
    supabase.from("medical_share_items").select("share_id", { count: "exact", head: true }).eq("share_id", s.id),
  ]);
  const now = Date.now();
  const live = !s.revoked_at && Date.parse(s.expires_at) > now;
  const yes = (b: boolean) => (b ? t("نعم", "Yes") : t("لا", "No"));
  return (
    <>
      <PageHead title={s.title} sub={s.recipient_label ?? undefined} actions={<Link className="btn" href={`/patients/${p.id}/sharing`}>{t("كل المشاركات", "All shares")}</Link>} />
      {s.revoked_at ? <Banner tone="bad" title={t("ملغاة", "Revoked")}>{fmtDateTime(s.revoked_at, lang, tz)}{s.revoke_reason ? ` — ${s.revoke_reason === "auto_revoked_too_many_failed_pins" ? t("أُلغيت تلقائياً بعد محاولات PIN خاطئة", "auto-revoked after repeated wrong PINs") : s.revoke_reason}` : ""}</Banner>
        : !live ? <Banner tone="warn" title={t("منتهية الصلاحية", "Expired")} />
        : s.locked_until && Date.parse(s.locked_until) > now ? <Banner tone="warn" title={t("مقفلة مؤقتاً بسبب محاولات PIN خاطئة", "Temporarily locked after wrong PIN attempts")}>{fmtDateTime(s.locked_until, lang, tz)}</Banner>
        : <Banner tone="ok" title={t("نشطة", "Active")}>{t("تنتهي", "expires")} {fmtDateTime(s.expires_at, lang, tz)}</Banner>}

      <Card title={t("النطاق والصلاحيات", "Scope & permissions")}>
        <KV items={[
          [t("النطاق", "Scope"), s.scope_kind === "full" ? t("الملف الكامل", "Whole file") : s.scope_kind === "specialty" ? s.specialty_ids.map((id: string) => specs.find((x) => x.id === id)?.[lang === "ar" ? "name_ar" : "name_en"]).filter(Boolean).join("، ") : t(`${itemCount ?? 0} سجل مختار`, `${itemCount ?? 0} selected records`)],
          [t("المعلومات الإضافية", "Extras"), (s.include as string[]).map((m) => SHARE_MODULES.find((x) => x.value === m)?.[lang]).filter(Boolean).join(" · ") || t("الأساسيات فقط", "Essentials only")],
          [t("الفترة", "Period"), s.date_from || s.date_to ? `${s.date_from ?? "…"} → ${s.date_to ?? "…"}` : null],
          [t("بنود حساسة", "Sensitive items"), yes(s.include_sensitive)], [t("تنزيل", "Download"), yes(s.allow_download)], [t("طباعة", "Print"), yes(s.allow_print)], [t("ملاحظات الطبيب", "Doctor notes"), yes(s.allow_notes)],
          [t("محاولات PIN المسموحة", "PIN attempts allowed"), `${s.max_attempts} (${t("عدد مرات القفل", "locks so far")}: ${s.lock_count})`],
          [t("أُنشئت", "Created"), fmtDateTime(s.created_at, lang, tz)],
        ]} />
        <p className="small muted">{t("لا يمكن عرض الرابط والرمز مرة أخرى لأنهما غير محفوظين بصيغة مقروءة. إن فُقدا فألغِ المشاركة وأنشئ غيرها.", "The link and PIN cannot be shown again because they are not stored in readable form. If lost, revoke and create a new share.")}</p>
        {live && access.canShare && (
          <ActionForm action={revokeShare} className="row" resetOnSuccess={false}>
            <input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={s.id} />
            <input name="reason" type="text" maxLength={300} placeholder={t("سبب الإلغاء (اختياري)", "Reason (optional)")} aria-label={t("سبب الإلغاء", "Reason")} style={{ maxWidth: 280 }} />
            <ConfirmButton message={t("إلغاء هذه المشاركة فوراً؟", "Revoke this share immediately?")} className="btn danger">{t("إلغاء المشاركة فوراً", "Revoke now")}</ConfirmButton>
          </ActionForm>)}
      </Card>

      {(notes ?? []).length > 0 && (
        <Card title={t("ملاحظات من الطبيب", "Notes from the doctor")}>
          <p className="small muted">{t("هذه اقتراحات لم تُضف لسجلك. انسخ ما تراه مناسباً إلى سجلك بنفسك.", "These are suggestions and were not added to your record. Copy over what you agree with.")}</p>
          {(notes ?? []).map((n) => (
            <article className="rec" key={n.id}><div className="row between"><strong>{n.author_name}</strong><span className="muted small">{fmtDateTime(n.created_at, lang, tz)}</span></div><p className="rec-body">{n.body}</p>
              {n.reviewed_at ? <Chip tone="ok">{t("روجعت", "Reviewed")}</Chip> : <form action={markNoteReviewed}><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={n.id} /><button className="btn sm">{t("تمت المراجعة", "Mark reviewed")}</button></form>}</article>))}
        </Card>
      )}

      <Card title={t(`سجل الوصول (${(logs ?? []).length})`, `Access log (${(logs ?? []).length})`)}>
        {(logs ?? []).length === 0 ? <Empty>{t("لا نشاط بعد.", "No activity yet.")}</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>{t("الوقت", "Time")}</th><th>{t("الحدث", "Event")}</th><th>{t("مصدر الاتصال (مُجزَّأ)", "Origin (hashed)")}</th><th>{t("المتصفح", "Browser")}</th></tr></thead>
            <tbody>{(logs ?? []).map((l) => (
              <tr key={l.id}><td className="nowrap">{fmtDateTime(l.at, lang, tz)}</td><td>{SHARE_EVENT[l.event]?.[lang] ?? l.event}</td><td><span className="ltr">{l.ip_hash ? String(l.ip_hash).slice(0, 8) : "—"}</span></td><td className="small muted">{l.user_agent ? String(l.user_agent).slice(0, 60) : ""}</td></tr>))}</tbody></table></div>)}
        <p className="small muted" style={{ marginBlockStart: ".5rem" }}>{t("لا يُسجَّل الرمز ولا الـ PIN. عنوان الاتصال يُحفظ بصيغة مُجزَّأة فقط.", "Neither the token nor the PIN is logged. The connection address is stored only as a salted hash.")}</p>
      </Card>
    </>
  );
}
