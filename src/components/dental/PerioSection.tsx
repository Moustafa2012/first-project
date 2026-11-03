import Link from "next/link";
import { FileDown, Plus } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { fmtPartialDate } from "@/lib/format";
import { comparePerio, siteName, summarize, type PerioExam, type PerioTooth } from "@/lib/perio";
import { dxLine, factorsFrom } from "@/lib/perio-staging";
import { Card, Chip, Empty } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { PerioChart } from "./PerioChart";
import { PerioDxView } from "./PerioDxView";
import { createPerioPlan, invalidatePerio, savePerio } from "@/app/actions/perio";

/** The periodontal chart tab: the open draft (or a new chart), the final charts, one of them drawn, and the comparison of two. */
export async function PerioSection({ pid, canWrite, lang, today, seedMissing, q }: {
  pid: string; canWrite: boolean; lang: Lang; today: string; seedMissing: number[];
  q: { pv?: string; pa?: string; pb?: string; pnew?: string };
}) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const supabase = createClient();
  const [{ data: examRows }, { data: toothRows }, { data: encRows }, { data: pat }, { data: life }, { data: condRows }, { data: hbType }] = await Promise.all([
    supabase.from("perio_exams").select("*").eq("patient_id", pid).eq("record_status", "active").order("exam_date", { ascending: false }).order("recorded_at", { ascending: false }),
    supabase.from("perio_teeth").select("*").eq("patient_id", pid),
    supabase.from("encounters").select("id, started_at, reason, kind").eq("patient_id", pid).eq("record_status", "active").order("started_at", { ascending: false }).limit(60),
    supabase.from("patients").select("date_of_birth").eq("id", pid).maybeSingle(),
    supabase.from("patient_health_profile").select("tobacco_status, cigarettes_per_day").eq("patient_id", pid).maybeSingle(),
    supabase.from("conditions").select("name, icd10_code").eq("patient_id", pid).eq("record_status", "active").in("clinical_status", ["active", "recurrence"]).neq("certainty", "refuted"),
    supabase.from("observation_types").select("id").eq("code", "hba1c").maybeSingle(),
  ]);
  const { data: hbRow } = hbType
    ? await supabase.from("observations").select("value_num").eq("patient_id", pid).eq("type_id", hbType.id as string).in("status", ["final", "preliminary", "amended"])
        .not("value_num", "is", null).order("effective_at", { ascending: false }).limit(1)
    : { data: null };
  const factors = factorsFrom({
    dob: (pat?.date_of_birth as string | null) ?? null, on: today, tobaccoStatus: life?.tobacco_status as string | undefined,
    cigarettesPerDay: life?.cigarettes_per_day == null ? null : Number(life.cigarettes_per_day),
    diabetes: (condRows ?? []).some((c) => /^E1[0-4]/i.test(String(c.icd10_code ?? "")) || /diabet|سكر/i.test(String(c.name ?? ""))),
    hba1c: hbRow?.[0]?.value_num == null ? null : Number(hbRow[0].value_num),
  });
  const visits = (encRows ?? []).map((e) => ({ id: e.id as string, label: `${fmtPartialDate(String(e.started_at).slice(0, 10), "day", lang)} — ${(e.reason as string | null) ?? (e.kind as string)}` }));
  const visitLabel = (id: string | null | undefined) => visits.find((v) => v.id === id)?.label ?? null;
  const teeth = (toothRows ?? []) as (PerioTooth & { exam_id: string })[];
  // a doctor's open draft is theirs: the account sees the doctor's charts once they are final
  const exams: PerioExam[] = (examRows ?? []).filter((e) => !(e.status === "draft" && e.contributed_by))
    .map((e) => ({ ...e, teeth: teeth.filter((x) => x.exam_id === e.id) })) as PerioExam[];
  const draft = exams.find((e) => e.status === "draft");
  const finals = exams.filter((e) => e.status === "final");
  const day = (v: string) => fmtPartialDate(v, "day", lang);
  const base = `/patients/${pid}/dental?tab=perio`;
  // a chosen final chart (the "View" link) is shown first, even while a draft is open; readers without write access fall back to the latest final chart
  const chosen = finals.find((e) => e.id === q.pv);
  const editing = canWrite && !chosen && Boolean(draft || q.pnew);
  const shown = chosen ?? (!editing ? finals[0] : undefined);
  // a new chart starts from the teeth known to be missing (last final chart, else the dental chart)
  const seed = finals[0] ? finals[0].teeth.filter((x) => x.missing).map((x) => x.tooth) : seedMissing;
  const ea = finals.find((e) => e.id === q.pa), eb = finals.find((e) => e.id === q.pb);
  const [older, newer] = ea && eb ? (ea.exam_date <= eb.exam_date ? [ea, eb] : [eb, ea]) : [undefined, undefined];
  const cmp = older && newer && older.id !== newer.id ? comparePerio(older.teeth, newer.teeth) : null;

  return (<>
    <Card id="perio" title={t("مخطط اللثة", "Periodontal chart")}
      description={t("ست نقاط لكل سن: عمق الجيب وموضع حافة اللثة والنزف والبلاك والقيح، مع الحركة وانقسام الجذور. يُحسب مستوى الارتباط تلقائياً. يبقى المخطط مسودة حتى يُعتمد، وبعد الاعتماد لا يُعدَّل.",
        "Six sites per tooth: pocket depth, gingival margin, bleeding, plaque and pus, with mobility and furcations. The attachment level is computed. A chart stays a draft until it is finalised; a final chart is not edited.")}
      actions={canWrite && !editing ? <Link className="btn primary sm" href={`${base}&pnew=1#perio`}><Plus size={16} aria-hidden="true" />{t("مخطط لثة جديد", "New periodontal chart")}</Link> : undefined}>
      {editing ? (<>
        {draft && (
          <div className="row between perio-draft-bar">
            <span><Chip tone="warn">{t("مسودة", "Draft")}</Chip> <span className="small muted">{t(`بدأت في ${day(draft.exam_date)} — تُستكمل من حيث توقفت.`, `Started ${day(draft.exam_date)} — continue where you left off.`)}</span></span>
            <ActionForm action={invalidatePerio} className="inline">
              <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={draft.id} /><input type="hidden" name="_discard" value="1" />
              <ConfirmButton className="btn ghost sm" message={t("إلغاء هذه المسودة؟ تبقى في السجل كمسودة ملغاة.", "Discard this draft? It stays in the log as a discarded draft.")}>{t("إلغاء المسودة", "Discard draft")}</ConfirmButton>
            </ActionForm>
          </div>
        )}
        <PerioChart key="perio-editor" lang={lang} teeth={draft?.teeth ?? []} edit={{
          action: savePerio, hidden: { _pid: pid }, examId: draft?.id ?? null, today, seedMissing: seed,
          header: { exam_date: draft?.exam_date ?? today, examiner_name: draft?.examiner_name ?? "", facility_name: draft?.facility_name ?? "", notes: draft?.notes ?? "" },
          dx: { factors, initial: draft ?? {}, visits, visitId: draft?.encounter_id ?? "" },
        }} />
      </>) : shown ? (<>
        <div className="row between perio-shown-bar">
          <span><Chip tone="ok">{t("معتمد", "Final")}</Chip> <strong>{day(shown.exam_date)}</strong>{shown.examiner_name ? <span className="muted"> — {shown.examiner_name}</span> : null}</span>
          <span className="row gap-sm">
            {canWrite && (
              <ActionForm action={createPerioPlan} className="inline">
                <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={shown.id} />
                <SubmitButton className="btn sm" pending={t("جارٍ الإنشاء…", "Creating…")}>{t("خطة لثوية بمراحل", "Phased gum treatment plan")}</SubmitButton>
              </ActionForm>
            )}
            <a className="btn sm" href={`/api/patients/${pid}/perio/${shown.id}/pdf`} target="_blank" rel="noopener"><FileDown size={16} aria-hidden="true" />PDF</a>
          </span>
        </div>
        <PerioDxView exam={shown} lang={lang} visit={visitLabel(shown.encounter_id)} />
        {shown.notes && <p className="small">{shown.notes}</p>}
        <PerioChart lang={lang} teeth={shown.teeth} />
      </>) : (
        <Empty title={t("لا يوجد مخطط لثة بعد", "No periodontal chart yet")}>
          {t("يسجّل طبيب الأسنان أو أخصائي اللثة القياسات في الفحص؛ أدخلها هنا من تقريره.", "The dentist or periodontist measures these at the exam; enter them here from their report.")}
        </Empty>
      )}
    </Card>

    {finals.length > 0 && (
      <Card id="perio-history" title={t("المخططات المعتمدة", "Final charts")}>
        <ul className="list perio-list">
          {finals.map((e) => {
            const sm = summarize(e.teeth);
            return (
              <li key={e.id} className="perio-item">
                <div className="row between">
                  <div>
                    <strong>{day(e.exam_date)}</strong>{e.examiner_name ? <span className="muted"> — {e.examiner_name}</span> : null}
                    {e.contributed_by && <> <Chip tone="info">{t(`سجّله ${e.examiner_name ?? ""} عبر رابط`, `Recorded by ${e.examiner_name ?? "a doctor"} via a link`)}</Chip></>}
                    {dxLine(e, lang) && <div className="small"><strong>{dxLine(e, lang)}</strong></div>}
                    <div className="row gap-sm wrap small">
                      <Chip tone={(sm.bopPct ?? 0) >= 10 ? "warn" : "ok"}>{t("نزف", "BOP")} {sm.bopPct ?? "—"}%</Chip>
                      <Chip tone={sm.pd4 ? "warn" : "ok"}>{t("جيوب ≥4", "PD ≥4")}: {sm.pd4}</Chip>
                      <Chip tone={sm.pd6 ? "bad" : "ok"}>{t("جيوب ≥6", "PD ≥6")}: {sm.pd6}</Chip>
                      <Chip>{t("أقصى CAL", "Max CAL")} {sm.maxCal ?? "—"}</Chip>
                    </div>
                  </div>
                  <div className="row gap-sm">
                    <Link className="btn ghost sm" href={`${base}&pv=${e.id}#perio`} aria-current={shown?.id === e.id ? "true" : undefined}>{t("عرض", "View")}</Link>
                    <a className="btn ghost sm" href={`/api/patients/${pid}/perio/${e.id}/pdf`} target="_blank" rel="noopener">PDF</a>
                  </div>
                </div>
                {canWrite && (
                  <details className="perio-invalidate">
                    <summary className="small muted">{t("إبطال (أُدخل خطأً)", "Invalidate (entered in error)")}</summary>
                    <ActionForm action={invalidatePerio}>
                      <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={e.id} />
                      <div className="field"><label htmlFor={`pr-${e.id}`}>{t("السبب", "Reason")}</label><input id={`pr-${e.id}`} name="reason" required minLength={3} maxLength={500} /></div>
                      <SubmitButton className="btn danger sm">{t("إبطال المخطط", "Invalidate the chart")}</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    )}

    {finals.length > 1 && (
      <Card id="perio-compare" title={t("مقارنة مخططين", "Compare two charts")}>
        <form method="get" action={`/patients/${pid}/dental#perio-compare`} className="row gap wrap perio-compare-form">
          <input type="hidden" name="tab" value="perio" />
          <div className="field"><label htmlFor="pa">{t("الأقدم", "Earlier")}</label>
            <select id="pa" name="pa" defaultValue={older?.id ?? finals[1].id}>{finals.map((e) => <option key={e.id} value={e.id}>{day(e.exam_date)}{e.examiner_name ? ` — ${e.examiner_name}` : ""}</option>)}</select></div>
          <div className="field"><label htmlFor="pb">{t("الأحدث", "Later")}</label>
            <select id="pb" name="pb" defaultValue={newer?.id ?? finals[0].id}>{finals.map((e) => <option key={e.id} value={e.id}>{day(e.exam_date)}{e.examiner_name ? ` — ${e.examiner_name}` : ""}</option>)}</select></div>
          <button type="submit" className="btn">{t("قارن", "Compare")}</button>
        </form>
        {cmp && older && newer && (<>
          <div className="table-wrap">
            <table className="t perio-cmp-sum">
              <thead><tr><th>{t("المؤشر", "Measure")}</th><th>{day(older.exam_date)}</th><th>{day(newer.exam_date)}</th></tr></thead>
              <tbody>
                {([
                  [t("النزف عند السبر", "Bleeding on probing"), cmp.before.bopPct, cmp.after.bopPct, "%"],
                  [t("البلاك", "Plaque"), cmp.before.plaquePct, cmp.after.plaquePct, "%"],
                  [t("جيوب ≥ 4 مم", "Pockets ≥ 4 mm"), cmp.before.pd4, cmp.after.pd4, ""],
                  [t("جيوب ≥ 6 مم", "Pockets ≥ 6 mm"), cmp.before.pd6, cmp.after.pd6, ""],
                  [t("متوسط الارتباط", "Mean CAL"), cmp.before.meanCal, cmp.after.meanCal, ""],
                  [t("الأسنان المفقودة", "Missing teeth"), cmp.before.missing, cmp.after.missing, ""],
                ] as [string, number | null, number | null, string][]).map(([k, a, b, u]) => (
                  <tr key={k}><th scope="row">{k}</th><td>{a ?? "—"}{a !== null ? u : ""}</td><td>{b ?? "—"}{b !== null ? u : ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">{t("يُحسب التغيّر في المواقع المسبورة في المخططين فقط؛ أقل من 2 مم يقع ضمن خطأ القياس.", "Only sites probed in both charts are compared; less than 2 mm is within probing error.")}</p>
          {cmp.lostTeeth.length > 0 && <p><Chip tone="bad">{t("أسنان فُقدت", "Teeth lost")}</Chip> {cmp.lostTeeth.join(lang === "ar" ? "، " : ", ")}</p>}
          <h4>{t(`مواقع فقدت ارتباطاً (${cmp.worse.length})`, `Sites that lost attachment (${cmp.worse.length})`)}</h4>
          {cmp.worse.length ? (
            <div className="table-wrap"><table className="t perio-cmp-worse">
              <thead><tr><th>{t("السن", "Tooth")}</th><th>{t("الموقع", "Site")}</th><th>{t("العمق", "Depth")}</th><th>{t("الارتباط", "CAL")}</th></tr></thead>
              <tbody>{cmp.worse.map((w) => (
                <tr key={`${w.tooth}-${w.site}`}><td><strong>{w.tooth}</strong></td><td>{siteName(w.site, w.tooth, lang)}</td><td>{w.pdBefore} → {w.pdAfter}</td>
                  <td><Chip tone="bad">{w.calBefore} → {w.calAfter} (+{w.dCal})</Chip></td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="small muted">{t("لا يوجد.", "None.")}</p>}
          <h4>{t(`مواقع تحسّن عمقها (${cmp.better.length})`, `Sites that got shallower (${cmp.better.length})`)}</h4>
          {cmp.better.length ? (
            <div className="table-wrap"><table className="t perio-cmp-better">
              <thead><tr><th>{t("السن", "Tooth")}</th><th>{t("الموقع", "Site")}</th><th>{t("العمق", "Depth")}</th></tr></thead>
              <tbody>{cmp.better.map((w) => (
                <tr key={`${w.tooth}-${w.site}`}><td><strong>{w.tooth}</strong></td><td>{siteName(w.site, w.tooth, lang)}</td><td><Chip tone="ok">{w.pdBefore} → {w.pdAfter}</Chip></td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="small muted">{t("لا يوجد.", "None.")}</p>}
        </>)}
      </Card>
    )}
  </>);
}
