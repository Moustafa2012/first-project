import { buildChart, type ChartPoint } from "@/lib/clinical/chart";
import type { Series } from "@/lib/clinical/series";
import { INTERPRETATION } from "@/lib/labels";
import type { Lang } from "@/lib/i18n";
import { fmtDate, fmtDateTime } from "@/lib/format";

const W = 680, H = 260;

/** Flagged readings use a diamond marker, so the flag is visible without relying on color. */
function Marker({ p, cls, title }: { p: ChartPoint; cls: string; title: string }) {
  const flagged = p.interp !== "normal" && p.interp !== "not_assessed";
  return flagged
    ? <path className={`dot ${cls}`} d={`M${p.x} ${p.y - 6.5} L${p.x + 6.5} ${p.y} L${p.x} ${p.y + 6.5} L${p.x - 6.5} ${p.y} Z`}><title>{title}</title></path>
    : <circle className={`dot ${cls}`} cx={p.x} cy={p.y} r={4}><title>{title}</title></circle>;
}

export function TrendChart({
  series, prev = [], lang, tz, refLines, domain, name, tableLabel, include, flagLegend = true, emptyLabel,
}: {
  series: Series[]; prev?: Series[]; lang: Lang; tz: string; refLines?: { v: number; label: string }[];
  domain?: { from: number; to: number }; name: string; tableLabel: string;
  /** values the y-axis must cover (e.g. [0, 10] for a severity scale) */
  include?: number[];
  /** the "flagged reading" legend entry; off for data that is never classified (symptom severity) */
  flagLegend?: boolean;
  emptyLabel?: [string, string];
}) {
  const chart = buildChart({ series: [...prev, ...series], width: W, height: H, domain, refLines, include });
  if (chart.empty) return <div className="empty">{emptyLabel ? emptyLabel[lang === "ar" ? 0 : 1] : lang === "ar" ? "لا توجد قراءات في هذه الفترة." : "No readings in this period."}</div>;
  const cls = (key: string) => { const i = series.findIndex((s) => s.key === key); return `s${Math.max(0, i) % 4}`; };
  const pk = new Set(prev.map((s) => s.key));
  const titleOf = (p: ChartPoint) => {
    const s = [...series, ...prev].find((x) => x.key === p.seriesKey)!;
    const src = s.pts.find((q) => q.id === p.id);
    return `${lang === "ar" ? s.label.ar : s.label.en}: ${p.v} ${s.unit} · ${fmtDateTime(new Date(p.t), lang, tz)} ${flagLegend ? ` · ${INTERPRETATION[p.interp]?.[lang] ?? ""}` : ""}${src?.lab ? ` · ${src.lab}` : ""}`;
  };
  const rows = series.flatMap((s) => s.pts.map((p) => ({ s, p }))).sort((a, b) => a.p.t - b.p.t);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={name}>
        {chart.yTicks.map((t) => (<g key={t.y}><line className="grid-l" x1={46} x2={W - 14} y1={t.y} y2={t.y} /><text className="axis" x={40} y={t.y + 4} textAnchor="end">{t.label}</text></g>))}
        {chart.xTicks.map((t, i) => (<text key={t.x} className="axis" x={t.x} y={H - 10} textAnchor={i === 0 ? "start" : i === chart.xTicks.length - 1 ? "end" : "middle"}>{fmtDate(new Date(t.t), lang, tz)}</text>))}
        {chart.refLines.map((r) => (<g key={r.label + r.y}><line className="ref" x1={46} x2={W - 14} y1={r.y} y2={r.y} /><text className="reflab" x={W - 16} y={r.y - 3} textAnchor="end">{r.label}</text></g>))}
        {chart.paths.map((p) => <path key={p.key} className={`line ${pk.has(p.key) ? "prev " : ""}${cls(p.key.replace(/^prev:/, ""))}`} d={p.d} />)}
        {chart.points.filter((p) => !pk.has(p.seriesKey)).map((p) => <Marker key={`${p.seriesKey}-${p.id}`} p={p} cls={cls(p.seriesKey)} title={titleOf(p)} />)}
      </svg>
      <div className="legend">
        {series.map((s, i) => <span key={s.key}><i style={{ background: `var(--c${(i % 4) + 1})` }} />{lang === "ar" ? s.label.ar : s.label.en} ({s.unit})</span>)}
        {prev.length > 0 && <span><i style={{ background: "var(--muted)", opacity: 0.6 }} />{lang === "ar" ? "الفترة السابقة (منقطة)" : "Previous period (dashed)"}</span>}
        {flagLegend && <span>◆ {lang === "ar" ? "قراءة مُعلَّمة تحتاج انتباهاً" : "flagged reading"}</span>}
      </div>
      <details style={{ marginBlockStart: ".5rem" }}>
        <summary className="small">{tableLabel}</summary>
        <div className="table-wrap"><table className="t"><tbody>
          {rows.map(({ s, p }) => (<tr key={`${s.key}-${p.id}`}><td>{fmtDateTime(new Date(p.t), lang, tz)}</td><td>{lang === "ar" ? s.label.ar : s.label.en}</td><td className="nowrap"><span className="ltr">{p.v} {s.unit}</span></td><td>{flagLegend ? INTERPRETATION[p.interp]?.[lang] : ""}</td></tr>))}
        </tbody></table></div>
      </details>
    </div>
  );
}
