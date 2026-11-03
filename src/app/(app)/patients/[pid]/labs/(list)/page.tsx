import Link from "next/link";
import { appliesToSex, forSex } from "@/lib/sex";
import { Plus, Printer } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getObsTypes, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { LAB_GROUP, LAB_STATUS, lbl } from "@/lib/labels";
import { buildSeries, inWindow, plottable, previousWindow, resolveWindow, shiftForward } from "@/lib/clinical/series";
import { qs } from "@/lib/qs";
import type { LabReportRow, ObservationRow } from "@/lib/types";
import { Banner, Card, Chip, Empty, InterpChip, PageHead } from "@/components/ui";
import { TrendChart } from "@/components/observations/TrendChart";
import { ObservationTable } from "@/components/observations/ObservationTable";
import { DerivedCard } from "@/components/observations/DerivedCard";
import { compareReports, reportDate } from "@/lib/care/labs-compare";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

type SP = Record<string, string | undefined>;

export default async function LabsPage({ params, searchParams }: { params: { pid: string }; searchParams: SP }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const [access, types] = await Promise.all([getAccess(p.id), getObsTypes()]);
  const labTypes = forSex(types, p.sex).filter((x) => x.category === "lab");
  const base = `/patients/${p.id}/labs`;
  const supabase = createClient();
  const view = searchParams.view === "trends" ? "trends" : searchParams.view === "compare" ? "compare" : "reports";

  const [{ data: reps }, { data: obsData }] = await Promise.all([
    supabase.from("lab_reports").select("*").eq("patient_id", p.id).eq("record_status", "active").order("collected_at", { ascending: false, nullsFirst: false }).limit(200),
    supabase.from("observations").select("*").eq("patient_id", p.id).in("type_id", labTypes.map((x) => x.id)).order("effective_at", { ascending: false }).limit(5000),
  ]);
  const reports = (reps ?? []) as LabReportRow[];
  const obs = (obsData ?? []) as ObservationRow[];
  const repById = new Map(reports.map((r) => [r.id, r]));

  const head = (
    <PageHead
      title={t("التحاليل المخبرية", "Laboratory results")}
      sub={t("كل تحليل بتاريخه ومختبره ومجاله المرجعي. تبقى النتائج القديمة وتُصحَّح بسجل جديد لا بالمحو.", "Each test with its date, lab and reference range. Old results stay; corrections are new records, never overwrites.")}
      actions={<><a className="btn" href={`/api/patients/${p.id}/report?scope=labs`} target="_blank" rel="noopener"><Printer size={16} aria-hidden="true" />{t("تقرير PDF للطباعة", "PDF report")}</a>{access.canWrite ? <Link className="btn primary" href={`${base}/new`}><Plus size={16} aria-hidden="true" />{t("تقرير تحاليل جديد", "New lab report")}</Link> : null}</>}
    />
  );
  const tabs = (
    <nav className="tabs" aria-label={t("العرض", "View")}>
      <Link href={base} aria-current={view === "reports" ? "true" : undefined}>{t("التقارير", "Reports")}</Link>
      <Link href={`${base}?view=trends`} aria-current={view === "trends" ? "true" : undefined}>{t("التتبع والمقارنة", "Trends & comparison")}</Link>
      <Link href={`${base}?view=compare`} aria-current={view === "compare" ? "true" : undefined}>{t("مقارنة تقريرين", "Compare two reports")}</Link>
    </nav>
  );

  if (view === "compare") {
    // two reports side by side: the later one is "b", the earlier "a" by default
    const withObs = reports.filter((r) => obs.some((o) => o.report_id === r.id));
    const byDate = [...withObs].sort((x, y) => reportDate(y).localeCompare(reportDate(x)));
    const pick = (id: string | undefined, fallback: LabReportRow | undefined) => withObs.find((r) => r.id === id) ?? fallback;
    const rb = pick(searchParams.b, byDate[0]), ra = pick(searchParams.a, byDate.find((r) => r.id !== rb?.id));
    const rows = ra && rb ? compareReports(obs.filter((o) => o.report_id === ra.id), obs.filter((o) => o.report_id === rb.id)) : [];
    const tyOf = new Map(types.map((x) => [x.id, x]));
    const nameOf = (r: (typeof rows)[number]) => r.customName || (tyOf.get(r.typeId) ? (lang === "ar" ? tyOf.get(r.typeId)!.name_ar : tyOf.get(r.typeId)!.name_en) : "");
    const optLabel = (r: LabReportRow) => `${reportDate(r)} — ${r.title}`;
    return (
      <>
        {head}{tabs}
        {withObs.length < 2 ? <Empty>{t("تحتاج تقريرين على الأقل بنتائج للمقارنة.", "You need at least two reports with results to compare.")}</Empty> : (
          <>
            <Card title={t("اختر تاريخي التقريرين", "Choose the two report dates")}>
              <form method="get" action={base} className="row" data-testid="compare-form">
                <input type="hidden" name="view" value="compare" />
                <div className="field"><label htmlFor="cmp_a">{t("التقرير الأول (الأقدم)", "First report (earlier)")}</label>
                  <select id="cmp_a" name="a" defaultValue={ra?.id}>{byDate.map((r) => <option key={r.id} value={r.id}>{optLabel(r)}</option>)}</select></div>
                <div className="field"><label htmlFor="cmp_b">{t("التقرير الثاني", "Second report")}</label>
                  <select id="cmp_b" name="b" defaultValue={rb?.id}>{byDate.map((r) => <option key={r.id} value={r.id}>{optLabel(r)}</option>)}</select></div>
                <button className="btn primary" type="submit">{t("قارن", "Compare")}</button>
              </form>
            </Card>
            {ra && rb && ra.id === rb.id ? <Banner tone="warn">{t("اختر تقريرين مختلفين.", "Choose two different reports.")}</Banner> : null}
            {ra && rb && ra.id !== rb.id && (
              <Card title={`${reportDate(ra)} ↔ ${reportDate(rb)}`}>
                {rows.length === 0 ? <Empty>{t("لا نتائج للمقارنة.", "No results to compare.")}</Empty> : (
                  <div className="table-wrap">
                    <table className="t" data-testid="compare-table">
                      <thead><tr><th>{t("التحليل", "Test")}</th><th><span className="ltr">{reportDate(ra)}</span></th><th><span className="ltr">{reportDate(rb)}</span></th><th>{t("التغير", "Change")}</th></tr></thead>
                      <tbody>{rows.map((r) => {
                        const Arrow = r.dir === "up" ? ArrowUp : r.dir === "down" ? ArrowDown : Minus;
                        const cell = (c: typeof r.a) => c ? (<><strong className="ltr">{c.value}</strong> <span className="muted small ltr">{c.unit ?? ""}</span> <InterpChip value={c.interpretation} lang={lang} /></>) : <span className="muted">—</span>;
                        return (
                          <tr key={r.key}>
                            <td>{nameOf(r)}</td><td className="nowrap">{cell(r.a)}</td><td className="nowrap">{cell(r.b)}</td>
                            <td className="nowrap">{r.delta != null ? (
                              <span className="row" style={{ gap: ".25rem" }}><Arrow size={14} aria-hidden="true" /><span className="ltr">{r.delta > 0 ? "+" : ""}{r.delta}{r.pct != null ? ` (${r.pct > 0 ? "+" : ""}${r.pct}%)` : ""}</span></span>
                            ) : <span className="muted small">{r.unitChanged ? t("وحدة مختلفة: لا فرق", "different unit: no difference") : !r.a ? t("جديد", "new") : !r.b ? t("غير مُعاد", "not repeated") : "—"}</span>}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                )}
                <p className="small muted" style={{ marginBlockStart: ".5rem" }}>{t("«التغير» يُحسب فقط بين قيمتين بالوحدة نفسها؛ لا تُحوَّل الوحدات.", "“Change” is computed only between two values in the same unit; units are never converted.")}</p>
              </Card>
            )}
          </>
        )}
      </>
    );
  }

  if (view === "reports") {
    const byReport = new Map<string, ObservationRow[]>();
    for (const o of obs) if (o.report_id) byReport.set(o.report_id, [...(byReport.get(o.report_id) ?? []), o]);
    return (
      <>
        {head}{tabs}
        <DerivedCard pid={p.id} />
        {reports.length === 0 ? <Empty>{t("لا توجد تقارير تحاليل بعد.", "No lab reports yet.")}</Empty> : reports.map((r) => {
          const list = (byReport.get(r.id) ?? []).sort((a, b) => a.effective_at.localeCompare(b.effective_at));
          const flagged = list.filter((o) => plottable(o) && !["normal", "not_assessed"].includes(o.interpretation)).length;
          return (
            <Card key={r.id} title={r.title} actions={<>
              <Chip tone={r.status === "final" ? "ok" : "warn"}>{lbl(LAB_STATUS, r.status, lang)}</Chip>
              {flagged > 0 && <Chip tone="warn">{t(`${flagged} خارج المجال`, `${flagged} out of range`)}</Chip>}
            </>}>
              <p className="muted small">
                {[r.lab_name, r.specimen_type, r.collected_at && `${t("العينة", "Sampled")}: ${fmtDateTime(r.collected_at, lang, tz)}`, r.approved_at && `${t("اعتماد", "Approved")}: ${fmtDate(r.approved_at, lang, tz)}`, r.approved_by_name].filter(Boolean).join(" · ")}
              </p>
              {r.lab_notes && <p className="small">{r.lab_notes}</p>}
              <ObservationTable rows={list} lang={lang} tz={tz} canWrite={access.canWrite} pid={p.id} returnPath={base} />
            </Card>
          );
        })}
      </>
    );
  }

  // ---- trends
  const withData = labTypes.filter((x) => obs.some((o) => o.type_id === x.id && plottable(o)));
  const type = labTypes.find((x) => x.code === searchParams.type) ?? withData[0];
  const groups = Array.from(new Set(withData.map((x) => x.lab_group ?? "other")));
  if (!type) return (<>{head}{tabs}<Empty>{t("أضف تقرير تحاليل لتظهر الاتجاهات.", "Add a lab report to see trends.")}</Empty></>);

  const rows = obs.filter((o) => o.type_id === type.id);
  const labOf = (o: ObservationRow) => (o.report_id ? repById.get(o.report_id)?.lab_name ?? null : null);
  const win = resolveWindow(searchParams.range ?? "all", searchParams.from, searchParams.to) ?? resolveWindow("all", undefined, undefined)!;
  const all = buildSeries(type, rows, labOf);
  const series = all.map((s) => ({ ...s, pts: inWindow(s.pts, win) }));
  const pw = searchParams.cmp === "1" ? previousWindow(win) : null;
  const prev = pw ? all.map((s) => ({ ...s, key: `prev:${s.key}`, pts: shiftForward(inWindow(s.pts, pw), win.from - pw.from) })).filter((s) => s.pts.length) : [];
  const allPts = series.flatMap((s) => s.pts);
  const sameRange = allPts.length > 0 && allPts.every((q) => q.refLow === allPts[0].refLow && q.refHigh === allPts[0].refHigh);
  const refLines = sameRange ? [
    ...(allPts[0].refLow != null ? [{ v: allPts[0].refLow, label: String(allPts[0].refLow) }] : []),
    ...(allPts[0].refHigh != null ? [{ v: allPts[0].refHigh, label: String(allPts[0].refHigh) }] : []),
  ] : undefined;
  const inRange = rows.filter((o) => { const x = Date.parse(o.effective_at); return x >= win.from && x <= win.to; });
  const cur = searchParams as Record<string, string | undefined>;
  const ranges: [string, string, string][] = [["90", "90 يوماً", "90 days"], ["365", "سنة", "1 year"], ["all", "الكل", "All"]];
  const active = searchParams.from || searchParams.to ? "custom" : searchParams.range ?? "all";
  const units = new Set(series.map((s) => s.unit));

  return (
    <>
      {head}{tabs}
      <div className="stack">
        {groups.map((g) => (
          <div key={g} className="row"><strong className="small" style={{ minWidth: 130 }}>{LAB_GROUP[g]?.[lang] ?? g}</strong>
            <div className="tabs">{withData.filter((x) => (x.lab_group ?? "other") === g).map((x) => (
              <Link key={x.id} href={`${base}${qs({ view: "trends", range: searchParams.range }, { type: x.code })}`} aria-current={x.id === type.id ? "true" : undefined}>{lang === "ar" ? x.name_ar : x.name_en}</Link>
            ))}</div></div>
        ))}
      </div>
      <Card title={lang === "ar" ? type.name_ar : type.name_en}>
        <div className="row between" style={{ marginBlockEnd: ".6rem" }}>
          <div className="tabs">{ranges.map(([v, ar, en]) => <Link key={v} href={`${base}${qs(cur, { range: v, from: undefined, to: undefined })}`} aria-current={active === v ? "true" : undefined}>{t(ar, en)}</Link>)}</div>
          <div className="tabs"><Link href={`${base}${qs(cur, { cmp: searchParams.cmp === "1" ? undefined : "1" })}`} aria-current={searchParams.cmp === "1" ? "true" : undefined}>{t("قارن بالفترة السابقة", "Compare with previous period")}</Link></div>
        </div>
        {units.size > 1 && <Banner tone="warn">{t("اختلفت وحدات القياس بين النتائج؛ تُعرض كل وحدة في خط مستقل ولا يُحسب فرق بينها.", "Units differ between results; each unit is drawn separately and no difference is computed across them.")}</Banner>}
        {!sameRange && allPts.length > 0 && <Banner tone="info">{t("المجالات المرجعية تختلف بين المختبرات، لذا لا تُرسم خطوط مرجعية موحدة. ضع المؤشر على النقطة لرؤية مجال كل نتيجة.", "Reference ranges differ between labs, so no single range is drawn. Hover a point to see each result’s range.")}</Banner>}
        <TrendChart series={series} prev={prev} lang={lang} tz={tz} refLines={refLines} domain={Number.isFinite(win.from) ? win : undefined}
          name={lang === "ar" ? type.name_ar : type.name_en} tableLabel={t("عرض القيم كجدول", "Show values as a table")} />
      </Card>
      <Card title={t("المقارنة بين النتائج", "Result-by-result comparison")}>
        <ObservationTable rows={inRange} lang={lang} tz={tz} canWrite={false} pid={p.id} returnPath={base} showDelta />
        <p className="small muted" style={{ marginBlockStart: ".5rem" }}>{t("«التغير» يُحسب فقط بين نتيجتين بالوحدة نفسها.", "“Change” is computed only between two results in the same unit.")}</p>
      </Card>
    </>
  );
}
