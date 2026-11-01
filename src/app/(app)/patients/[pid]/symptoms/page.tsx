import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import { qs } from "@/lib/qs";
import { ENTITIES, type FormContext } from "@/lib/entities";
import { inWindow, resolveWindow, stats } from "@/lib/clinical/series";
import { COMMON_SYMPTOMS, groupSymptoms, SEVERITY_SCALE, symptomSeries, type SymptomPoint } from "@/lib/symptoms";
import { Banner, Card, Empty, PageHead } from "@/components/ui";
import { EntitySection } from "@/components/EntitySection";
import { EntityForm } from "@/components/EntityForm";
import { TrendChart } from "@/components/observations/TrendChart";

export const metadata = { title: "سجل الأعراض" };

type SP = Record<string, string | undefined>;

export default async function SymptomsPage({ params, searchParams }: { params: { pid: string }; searchParams: SP }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  const supabase = createClient();
  const base = `/patients/${p.id}/symptoms`;

  const [{ data }, { data: conds }] = await Promise.all([
    supabase.from("symptom_entries").select("id, symptom, severity, onset_at, ended_at").eq("patient_id", p.id).eq("record_status", "active").order("onset_at", { ascending: false }).limit(3000),
    supabase.from("conditions").select("id, name").eq("patient_id", p.id).eq("record_status", "active").neq("certainty", "refuted").order("name").limit(200),
  ]);
  const rows = (data ?? []) as SymptomPoint[];
  const groups = groupSymptoms(rows);
  const chosen = groups.find((g) => g.key === searchParams.s) ?? null;
  const shown = chosen ?? groups[0] ?? null;           // the chart follows the selected symptom, or the most recent one
  const win = resolveWindow(searchParams.range, undefined, undefined) ?? resolveWindow("90", undefined, undefined)!;
  const series = shown ? symptomSeries(rows, shown).map((s) => ({ ...s, pts: inWindow(s.pts, win) })) : [];
  const st = series[0] ? stats(series[0].pts) : null;
  const activeRange = searchParams.range ?? "90";
  const rangeLinks: [string, string, string][] = [["30", "30 يوماً", "30 days"], ["90", "90 يوماً", "90 days"], ["365", "سنة", "1 year"], ["all", "الكل", "All"]];
  const cur = searchParams as Record<string, string | undefined>;

  const names = Array.from(new Set([...groups.map((g) => g.label), ...COMMON_SYMPTOMS.map((x) => (lang === "ar" ? x[0] : x[1]))]));
  const choices = (conds ?? []).map((c) => ({ value: c.id as string, ar: c.name as string, en: c.name as string }));
  const ctx: FormContext = { suggest: { symptom: names }, choices: { condition_id: choices } };
  const quick: FormContext = { ...ctx, pick: ["symptom", "severity", "onset_at", "body_site", "pattern"] };

  return (
    <>
      <PageHead
        title={t("سجل الأعراض", "Symptom log")}
        sub={t("سجّل ما تشعر به وقت حدوثه، ثم تابع شدته عبر الزمن لتعرض الصورة كاملة على طبيبك.", "Note what you feel as it happens, then follow its severity over time to show your doctor the whole picture.")}
      />
      <Banner tone="info">
        {t("الأعراض تسجيل لما يصفه المريض وليست تشخيصاً. إن كان العرض شديداً أو مفاجئاً فاطلب رعاية طبية عاجلة.", "Symptoms are what the patient describes, not a diagnosis. For a severe or sudden symptom seek urgent medical care.")}
      </Banner>

      {access.canWrite && (
        <Card id="quick" title={t("تسجيل سريع", "Quick entry")}>
          <EntityForm entity={ENTITIES.symptoms} pid={p.id} specialties={[]} returnPath={base} context={quick} idPrefix="quick"
            defaults={{ severity: "" }} submitLabel={t("تسجيل العرض", "Log symptom")} />
        </Card>
      )}

      <Card title={shown ? t(`شدة «${shown.label}» عبر الزمن`, `Severity of “${shown.label}” over time`) : t("شدة العرض عبر الزمن", "Symptom severity over time")}>
        {groups.length === 0 ? <Empty>{t("لا أعراض مسجلة بعد. سجّل أول عرض من النموذج أعلاه.", "No symptoms logged yet. Log the first one above.")}</Empty> : (
          <>
            <nav className="tabs" aria-label={t("العرض", "Symptom")}>
              {groups.map((g) => (
                <Link key={g.key} href={`${base}${qs(cur, { s: g.key })}`} aria-current={shown?.key === g.key ? "true" : undefined}>
                  {g.label} <span className="muted small">({g.n})</span>
                </Link>
              ))}
            </nav>
            <div className="tabs" aria-label={t("الفترة", "Period")} style={{ marginBlockStart: ".5rem" }}>
              {rangeLinks.map(([v, ar, en]) => <Link key={v} href={`${base}${qs(cur, { range: v })}`} aria-current={activeRange === v ? "true" : undefined}>{t(ar, en)}</Link>)}
            </div>
            {st ? (
              <div className="grid cols-4" style={{ marginBlock: ".9rem" }}>
                <div className="tile"><div className="k">{t("آخر شدة", "Latest severity")}</div><div className="v"><span className="ltr">{fmtNum(st.latest.v, 0)}</span><span className="u">/10</span></div></div>
                <div className="tile"><div className="k">{t("المتوسط", "Average")}</div><div className="v"><span className="ltr">{fmtNum(st.mean, 1)}</span><span className="u">/10</span></div></div>
                <div className="tile"><div className="k">{t("الأعلى", "Highest")}</div><div className="v"><span className="ltr">{fmtNum(st.max, 0)}</span><span className="u">/10</span></div></div>
                <div className="tile"><div className="k">{t("المرات المسجلة", "Entries")}</div><div className="v">{st.count}</div>
                  <div className="small">{st.trend === "flat" ? t("مستقر تقريباً", "about stable") : st.trend === "up" ? t("↑ ازدادت الشدة", "↑ got worse") : t("↓ خفّت الشدة", "↓ got milder")}</div></div>
              </div>
            ) : null}
            <TrendChart series={series} lang={lang} tz={tz} domain={Number.isFinite(win.from) ? win : undefined} include={SEVERITY_SCALE} flagLegend={false}
              name={shown ? t(`شدة ${shown.label}`, `Severity of ${shown.label}`) : ""} tableLabel={t("عرض القيم كجدول", "Show values as a table")}
              emptyLabel={["لا توجد شدة مسجلة لهذا العرض في هذه الفترة.", "No severity recorded for this symptom in this period."]} />
            <p className="small muted">{t("الشدة من 0 (لا شيء) إلى 10 (الأشد). تُرسم الإدخالات التي سُجلت لها شدة فقط.", "Severity runs from 0 (none) to 10 (worst). Only entries with a severity are plotted.")}</p>
          </>
        )}
      </Card>

      <EntitySection entity={ENTITIES.symptoms} pid={p.id} returnPath={base} id="log"
        title={chosen ? t(`سجل «${chosen.label}»`, `Log of “${chosen.label}”`) : t("كل الأعراض", "All symptoms")}
        addLabel={t("إضافة عرض بتفاصيله", "Add a symptom in detail")}
        filter={chosen ? { symptom: chosen.raw } : {}} context={ctx} limit={300}
        empty={<Empty>{chosen ? t("لا سجلات لهذا العرض.", "No entries for this symptom.") : t("لا أعراض مسجلة بعد.", "No symptoms logged yet.")}</Empty>} />
      {chosen && <p><Link className="small" href={`${base}${qs(cur, { s: undefined })}`}>{t("عرض كل الأعراض", "Show all symptoms")}</Link></p>}
    </>
  );
}
