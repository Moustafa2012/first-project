import Link from "next/link";
import { appliesToSex, forSex } from "@/lib/sex";
import { Printer } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getObsTypes, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtNum } from "@/lib/format";
import { CONTEXT_BY_TYPE, SETTING } from "@/lib/labels";
import { bucket, buildSeries, inWindow, previousWindow, resolveWindow, shiftForward, stats, plottable } from "@/lib/clinical/series";
import { REF_LINES } from "@/lib/clinical/refs";
import { qs } from "@/lib/qs";
import type { ObservationRow } from "@/lib/types";
import { Banner, Card, Empty, PageHead } from "@/components/ui";
import { TrendChart } from "@/components/observations/TrendChart";
import { ObservationTable } from "@/components/observations/ObservationTable";
import { VitalForm } from "@/components/observations/VitalForm";

type SP = Record<string, string | undefined>;

export default async function VitalsPage({ params, searchParams }: { params: { pid: string }; searchParams: SP }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const [access, types] = await Promise.all([getAccess(p.id), getObsTypes()]);
  const vitalTypes = forSex(types, p.sex).filter((x) => x.category !== "lab");
  const type = vitalTypes.find((x) => x.code === searchParams.type) ?? vitalTypes[0];
  const base = `/patients/${p.id}/vitals`;

  const supabase = createClient();
  const [{ data }, { data: encs }] = await Promise.all([
    supabase.from("observations").select("*").eq("patient_id", p.id).eq("type_id", type.id).order("effective_at", { ascending: false }).limit(5000),
    supabase.from("encounters").select("id, kind, reason, started_at").eq("patient_id", p.id).eq("record_status", "active").order("started_at", { ascending: false }).limit(20),
  ]);
  let rows = (data ?? []) as ObservationRow[];
  if (searchParams.setting) rows = rows.filter((r) => r.setting === searchParams.setting);
  if (searchParams.context) rows = rows.filter((r) => r.context === searchParams.context);

  const win = resolveWindow(searchParams.range, searchParams.from, searchParams.to) ?? resolveWindow("90", undefined, undefined)!;
  const all = buildSeries(type, rows);
  const series = all.map((s) => ({ ...s, pts: inWindow(s.pts, win) }));
  const pw = searchParams.cmp === "1" ? previousWindow(win) : null;
  const shift = pw ? win.from - pw.from : 0;
  const prev = pw ? all.map((s) => ({ ...s, key: `prev:${s.key}`, pts: shiftForward(inWindow(s.pts, pw), shift) })).filter((s) => s.pts.length) : [];
  const inRange = rows.filter((r) => { const tt = Date.parse(r.effective_at); return tt >= win.from && tt <= win.to; });
  const flagged = inRange.filter((r) => plottable(r) && !["normal", "not_assessed"].includes(r.interpretation)).length;
  const sameUnit = series.length > 0 && series.every((s) => s.unit === type.default_unit);
  const refLines = sameUnit ? REF_LINES[type.code] : undefined;
  const agg = (["day", "week", "month"] as const).find((a) => a === searchParams.agg);

  const cur = searchParams as Record<string, string | undefined>;
  const rangeLinks: [string, string, string][] = [["7", "7 أيام", "7 days"], ["30", "30 يوماً", "30 days"], ["90", "90 يوماً", "90 days"], ["365", "سنة", "1 year"], ["all", "الكل", "All"]];
  const activeRange = searchParams.from || searchParams.to ? "custom" : searchParams.range ?? "90";
  const ctxOpts = CONTEXT_BY_TYPE[type.code] ?? [];

  return (
    <>
      <PageHead
        title={t("القياسات الحيوية", "Vital signs & home readings")}
        sub={t("سجّل قراءات الضغط والسكر والوزن وغيرها لتظهر اتجاهاتها عبر الزمن.", "Log blood pressure, glucose, weight and more to see how they change over time.")}
        actions={<a className="btn sm" href={`/api/patients/${p.id}/report${qs({ scope: "vitals", type: type.code, range: searchParams.range, from: searchParams.from, to: searchParams.to })}`} target="_blank" rel="noopener"><Printer size={14} aria-hidden="true" />{t("تقرير PDF للطباعة", "PDF report")}</a>}
      />
      <Banner tone="info">
        {t("التصنيفات (مرتفع / منخفض…) مؤشرات فحص عامة للبالغين وليست تشخيصاً؛ تتطلب تقييم مختص. قراءات غير البالغين وقراءات ما بعد الجهد لا تُصنَّف.",
           "Flags (high / low…) are general adult screening prompts, not a diagnosis, and need a professional’s assessment. Readings for under-18s and after exertion are not classified.")}
      </Banner>

      <nav className="tabs" aria-label={t("نوع القياس", "Measurement")}>
        {vitalTypes.map((x) => <Link key={x.id} href={`${base}${qs({ range: searchParams.range, cmp: searchParams.cmp }, { type: x.code })}`} aria-current={x.id === type.id ? "true" : undefined}>{lang === "ar" ? x.name_ar : x.name_en}</Link>)}
      </nav>

      {access.canWrite && (
        <Card title={t(`تسجيل قراءة: ${type.name_ar}`, `Log a reading: ${type.name_en}`)}>
          <VitalForm pid={p.id} type={type} encounters={(encs ?? []).map((e) => ({ id: e.id as string, label: `${fmtDate(e.started_at as string, lang, tz)} — ${(e.reason as string) ?? e.kind}` }))} />
        </Card>
      )}

      <Card title={lang === "ar" ? type.name_ar : type.name_en}>
        <div className="row between" style={{ marginBlockEnd: ".75rem" }}>
          <div className="tabs" aria-label={t("الفترة", "Period")}>
            {rangeLinks.map(([v, ar, en]) => <Link key={v} href={`${base}${qs(cur, { range: v, from: undefined, to: undefined })}`} aria-current={activeRange === v ? "true" : undefined}>{t(ar, en)}</Link>)}
          </div>
          <div className="tabs">
            <Link href={`${base}${qs(cur, { cmp: searchParams.cmp === "1" ? undefined : "1" })}`} aria-current={searchParams.cmp === "1" ? "true" : undefined}>{t("قارن بالفترة السابقة", "Compare with previous period")}</Link>
          </div>
        </div>
        <form method="get" className="row no-print" style={{ marginBlockEnd: ".75rem" }}>
          <input type="hidden" name="type" value={type.code} />
          <label className="small">{t("من", "From")} <input type="date" name="from" defaultValue={searchParams.from ?? ""} style={{ width: "auto" }} /></label>
          <label className="small">{t("إلى", "To")} <input type="date" name="to" defaultValue={searchParams.to ?? ""} style={{ width: "auto" }} /></label>
          <label className="small">{t("المكان", "Where")}
            <select name="setting" defaultValue={searchParams.setting ?? ""} style={{ width: "auto" }}><option value="">{t("الكل", "All")}</option>{SETTING.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></label>
          {ctxOpts.length > 0 && <label className="small">{t("الظروف", "Conditions")}
            <select name="context" defaultValue={searchParams.context ?? ""} style={{ width: "auto" }}><option value="">{t("الكل", "All")}</option>{ctxOpts.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></label>}
          <button className="btn sm">{t("تطبيق", "Apply")}</button>
          {(searchParams.from || searchParams.to || searchParams.setting || searchParams.context) && <Link className="btn ghost sm" href={`${base}?type=${type.code}`}>{t("مسح", "Clear")}</Link>}
        </form>

        {series.some((s) => s.pts.length) ? (
          <>
            <div className="grid cols-4" style={{ marginBlockEnd: ".9rem" }}>
              {series.filter((s) => s.pts.length).map((s) => {
                const st = stats(s.pts)!;
                const label = lang === "ar" ? s.label.ar : s.label.en;
                return (
                  <div className="tile" key={s.key}>
                    <div className="k">{label} · {t("آخر قراءة", "latest")}</div>
                    <div className="v"><span className="ltr">{fmtNum(st.latest.v, type.decimals)}</span><span className="u">{s.unit}</span></div>
                    <div className="small muted">
                      {t("المتوسط", "avg")} <span className="ltr">{fmtNum(st.mean, type.decimals)}</span> · {t("أدنى", "min")} <span className="ltr">{fmtNum(st.min, type.decimals)}</span> · {t("أعلى", "max")} <span className="ltr">{fmtNum(st.max, type.decimals)}</span> · {st.count} {t("قراءة", "readings")}
                    </div>
                    <div className="small">{st.trend === "flat" ? t("مستقر تقريباً", "about stable") : st.trend === "up" ? t("↑ ارتفع خلال الفترة", "↑ rose over the period") : t("↓ انخفض خلال الفترة", "↓ fell over the period")}</div>
                  </div>
                );
              })}
              <div className="tile"><div className="k">{t("قراءات مُعلَّمة", "Flagged readings")}</div><div className="v">{flagged}</div><div className="small muted">{t("تستدعي نظرة مختص", "worth a professional look")}</div></div>
            </div>
            {new Set(series.map((s) => s.unit)).size > 1 && <Banner tone="warn">{t("القراءات بوحدات مختلفة تُعرض في خطوط منفصلة ولا تُقارن ببعضها.", "Readings in different units are drawn as separate lines and are not compared.")}</Banner>}
            <TrendChart series={series} prev={prev} lang={lang} tz={tz} refLines={refLines} domain={Number.isFinite(win.from) ? win : undefined}
              name={`${lang === "ar" ? type.name_ar : type.name_en}`} tableLabel={t("عرض القيم كجدول", "Show values as a table")} />
            {sameUnit && refLines && <p className="small muted">{t("الخطوط المتقطعة: قيم مرجعية عامة للبالغين.", "Dashed lines: general adult guide values.")}</p>}
          </>
        ) : <Empty>{t("لا توجد قراءات في هذه الفترة.", "No readings in this period.")}</Empty>}
      </Card>

      {agg !== undefined || series.some((s) => s.pts.length) ? (
        <Card title={t("ملخصات دورية", "Periodic summaries")}>
          <div className="tabs" style={{ marginBlockEnd: ".6rem" }}>
            {([["raw", "خام", "Raw"], ["day", "يومي", "Daily"], ["week", "أسبوعي", "Weekly"], ["month", "شهري", "Monthly"]] as const).map(([v, ar, en]) => (
              <Link key={v} href={`${base}${qs(cur, { agg: v === "raw" ? undefined : v })}`} aria-current={(agg ?? "raw") === v ? "true" : undefined}>{t(ar, en)}</Link>
            ))}
          </div>
          {agg ? series.filter((s) => s.pts.length).map((s) => (
            <div key={s.key} className="table-wrap" style={{ marginBlockEnd: ".6rem" }}>
              <table className="t"><caption className="small muted" style={{ textAlign: "start" }}>{lang === "ar" ? s.label.ar : s.label.en} ({s.unit})</caption>
                <thead><tr><th>{t("الفترة", "Period")}</th><th>{t("العدد", "n")}</th><th>{t("المتوسط", "Mean")}</th><th>{t("أدنى", "Min")}</th><th>{t("أعلى", "Max")}</th></tr></thead>
                <tbody>{bucket(s.pts, agg).reverse().map((b) => (<tr key={b.start}><td>{fmtDate(new Date(b.start), lang, "UTC")}</td><td>{b.n}</td><td><span className="ltr">{fmtNum(b.mean, type.decimals + 1)}</span></td><td><span className="ltr">{fmtNum(b.min, type.decimals)}</span></td><td><span className="ltr">{fmtNum(b.max, type.decimals)}</span></td></tr>))}</tbody>
              </table>
            </div>
          )) : <p className="muted small">{t("اختر يومياً أو أسبوعياً أو شهرياً لعرض المتوسطات.", "Pick daily, weekly or monthly to see averages.")}</p>}
        </Card>
      ) : null}

      <Card title={t("سجل القراءات", "Reading history")}>
        {inRange.length === 0 ? <Empty>{t("لا توجد قراءات.", "No readings.")}</Empty> : (
          <ObservationTable rows={inRange} lang={lang} tz={tz} canWrite={access.canWrite} pid={p.id} returnPath={base} showDelta />
        )}
      </Card>
    </>
  );
}
