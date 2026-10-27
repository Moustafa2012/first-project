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
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { TrendChart } from "@/components/observations/TrendChart";
import { ObservationTable } from "@/components/observations/ObservationTable";

type SP = Record<string, string | undefined>;

export default async function LabsPage({ params, searchParams }: { params: { pid: string }; searchParams: SP }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const [access, types] = await Promise.all([getAccess(p.id), getObsTypes()]);
  const labTypes = forSex(types, p.sex).filter((x) => x.category === "lab");
  const base = `/patients/${p.id}/labs`;
  const supabase = createClient();
  const view = searchParams.view === "trends" ? "trends" : "reports";

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
    </nav>
  );

  if (view === "reports") {
    const byReport = new Map<string, ObservationRow[]>();
    for (const o of obs) if (o.report_id) byReport.set(o.report_id, [...(byReport.get(o.report_id) ?? []), o]);
    return (
      <>
        {head}{tabs}
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
