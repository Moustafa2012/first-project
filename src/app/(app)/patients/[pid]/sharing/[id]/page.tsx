import Link from "next/link";
import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient, getSpecialties, UUID_RE } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { CONTRIB_MODULES, SHARE_EVENT, SHARE_MODULES } from "@/lib/labels";
import { Banner, Card, Chip, Empty, KV, PageHead } from "@/components/ui";
import { ActionForm, ConfirmButton } from "@/components/ui/client";
import { invalidateContributions, markContributorReviewed, markNoteReviewed, revokeShare } from "@/app/actions/sharing";

// what each table shows as the title of an addition
const CONTRIB_LABEL: Record<string, string> = {
  encounters: "id, reason, kind, started_at, record_status, contributed_by", conditions: "id, name, recorded_at, record_status, contributed_by",
  procedures: "id, name, recorded_at, record_status, contributed_by", clinical_notes: "id, title, body, noted_at, record_status, contributed_by",
  medications: "id, name_generic, name_brand, recorded_at, record_status, contributed_by", appointments: "id, reason, scheduled_at, record_status, contributed_by",
  test_orders: "id, name, recorded_at, record_status, contributed_by", imaging_studies: "id, modality, body_site, recorded_at, record_status, contributed_by",
  medical_documents: "id, title, uploaded_at, record_status, contributed_by",
  dental_exams: "id, exam_date, recorded_at, record_status, contributed_by",
};
const CONTRIB_PAGE: Record<string, string> = {
  encounters: "visits", conditions: "conditions", procedures: "procedures", clinical_notes: "notes", medications: "medications",
  appointments: "appointments", test_orders: "test-orders", imaging_studies: "imaging", medical_documents: "documents", dental_exams: "dental",
};

export default async function ShareDetail({ params }: { params: { pid: string; id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  if (!access.canShare) notFound();
  const supabase = createClient();
  const { data: s } = await supabase.from("medical_shares").select("id, title, recipient_label, scope_kind, specialty_ids, include, include_sensitive, date_from, date_to, allow_download, allow_print, allow_notes, allow_contribute, contribute_modules, max_contributions, max_attempts, failed_attempts, lock_count, locked_until, expires_at, revoked_at, revoke_reason, last_accessed_at, access_count, created_at").eq("id", params.id).eq("patient_id", p.id).maybeSingle();
  if (!s) notFound();
  const [specs, { data: logs }, { data: notes }, { count: itemCount }, { data: ctrs }] = await Promise.all([
    getSpecialties(),
    supabase.from("medical_share_access_logs").select("id, event, ip_hash, user_agent, at, detail").eq("share_id", s.id).order("at", { ascending: false }).limit(200),
    supabase.from("share_notes").select("id, author_name, body, created_at, reviewed_at").eq("share_id", s.id).order("created_at", { ascending: false }),
    supabase.from("medical_share_items").select("share_id", { count: "exact", head: true }).eq("share_id", s.id),
    supabase.from("share_contributors").select("id, full_name, specialty, license_no, facility, phone, attested_at, contribution_count, last_contribution_at, reviewed_at").eq("share_id", s.id).order("created_at"),
  ]);
  const contributors = (ctrs ?? []) as { id: string; full_name: string; specialty: string | null; license_no: string | null; facility: string | null; phone: string | null; attested_at: string; contribution_count: number; last_contribution_at: string | null; reviewed_at: string | null }[];
  // everything the clinicians of this share added, newest first
  type Added = { table: string; id: string; label: string; at: string; record_status: string; contributed_by: string };
  const added: Added[] = contributors.length === 0 ? [] : (await Promise.all(Object.entries(CONTRIB_LABEL).map(async ([table, cols]) => {
    const { data } = await supabase.from(table).select(cols).eq("patient_id", p.id).in("contributed_by", contributors.map((c) => c.id));
    return ((data ?? []) as unknown as Record<string, string | null>[]).map((r): Added => ({
      table, id: String(r.id), record_status: String(r.record_status), contributed_by: String(r.contributed_by),
      label: String(r.name ?? r.title ?? r.exam_date ?? r.reason ?? r.name_generic ?? r.name_brand ?? (r.body ? r.body.slice(0, 80) : null) ?? [r.modality, r.body_site].filter(Boolean).join(" — ") ?? r.kind ?? "—"),
      at: String(r.recorded_at ?? r.started_at ?? r.noted_at ?? r.scheduled_at ?? r.uploaded_at ?? ""),
    }));
  }))).flat().sort((a, b) => b.at.localeCompare(a.at));
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
          [t("إضافة الطبيب إلى الملف", "Doctor adds to the file"), s.allow_contribute ? (s.contribute_modules as string[]).map((m) => CONTRIB_MODULES.find((x) => x.value === m)?.[lang]).filter(Boolean).join(" · ") + ` (${t("حد أقصى", "max")} ${s.max_contributions})` : t("لا", "No")],
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

      {contributors.length > 0 && (
        <Card title={t("الأطباء الذين أضافوا إلى ملفك", "Doctors who added to your file")}>
          <p className="small muted">{t("كل إضافة تحمل اسم الطبيب كما عرّف به نفسه وتوقيعه. لا يستطيع تعديل ما سجلتَه. يمكنك إبطال أي إضافة من صفحتها، أو إبطال كل إضافات طبيب هنا.",
            "Each addition carries the doctor's name as they stated it and their signature. They cannot change what you recorded. Invalidate any single addition from its page, or everything from one doctor here.")}</p>
          {contributors.map((c) => {
            const mine = added.filter((a) => a.contributed_by === c.id);
            const pending = c.contribution_count > 0 && (!c.reviewed_at || (c.last_contribution_at != null && c.last_contribution_at > c.reviewed_at));
            return (
              <article className="rec" key={c.id}>
                <div className="row between">
                  <div><strong>{c.full_name}</strong> {[c.specialty, c.facility, c.license_no && `${t("ترخيص", "license")} ${c.license_no}`, c.phone].filter(Boolean).map((x) => <Chip key={String(x)} tone="muted">{x}</Chip>)}
                    <div className="small muted">{t("عرّف بنفسه ووقّع", "Identified and signed")} {fmtDateTime(c.attested_at, lang, tz)} · {t(`${c.contribution_count} إضافة`, `${c.contribution_count} addition(s)`)}</div></div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="sig-img" src={`/api/signatures/${c.id}`} alt={t(`توقيع ${c.full_name}`, `Signature of ${c.full_name}`)} loading="lazy" />
                </div>
                {mine.length > 0 && (
                  <ul style={{ margin: ".5rem 0", paddingInlineStart: "1.1rem" }}>{mine.map((a) => (
                    <li key={`${a.table}:${a.id}`}><Link href={`/patients/${p.id}/${CONTRIB_PAGE[a.table]}`}>{CONTRIB_MODULES.find((x) => x.value === a.table)?.[lang]}: {a.label}</Link>
                      {a.record_status !== "active" && <> <Chip tone="bad">{t("مُبطل", "Invalidated")}</Chip></>} <span className="muted small">{a.at ? fmtDateTime(a.at, lang, tz) : ""}</span></li>))}</ul>
                )}
                <div className="row">
                  {pending ? <form action={markContributorReviewed}><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={c.id} /><button className="btn sm">{t("راجعتُ إضافاته", "I reviewed these additions")}</button></form>
                    : <Chip tone="ok">{t("روجعت", "Reviewed")}</Chip>}
                  {access.canWrite && mine.some((a) => a.record_status === "active") && (
                    <details className="fold"><summary>{t("إبطال كل إضافات هذا الطبيب", "Invalidate everything this doctor added")}</summary>
                      <div className="fold-body">
                        <ActionForm action={invalidateContributions} className="row">
                          <input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={c.id} />
                          <input name="reason" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 180 }} />
                          <ConfirmButton message={t("إبطال كل ما أضافه هذا الطبيب؟ تبقى السجلات في التاريخ.", "Invalidate everything this doctor added? The records stay in the history.")}>{t("إبطال الكل", "Invalidate all")}</ConfirmButton>
                        </ActionForm>
                      </div>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </Card>
      )}

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
