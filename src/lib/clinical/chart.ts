import type { Series } from "./series";

export interface ChartInput {
  series: Series[];
  width: number;
  height: number;
  /** x-axis extent; defaults to the data extent */
  domain?: { from: number; to: number };
  refLines?: { v: number; label: string }[];
  margin?: { l: number; r: number; t: number; b: number };
}

export interface ChartPoint { x: number; y: number; id: string; v: number; t: number; interp: string; seriesKey: string }
export interface ChartOutput {
  paths: { key: string; role: string; d: string }[];
  points: ChartPoint[];
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; t: number }[];
  refLines: { y: number; label: string }[];
  yDomain: [number, number];
  empty: boolean;
}

/** Round, human-friendly tick values covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const span = max - min;
  const rough = span / Math.max(1, target - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const step = ([1, 2, 2.5, 5, 10].find((c) => c >= frac - 1e-9) ?? 10) * pow;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export function buildChart(input: ChartInput): ChartOutput {
  const { series, width, height } = input;
  const m = input.margin ?? { l: 46, r: 14, t: 14, b: 30 };
  const all = series.flatMap((s) => s.pts);
  if (!all.length) return { paths: [], points: [], yTicks: [], xTicks: [], refLines: [], yDomain: [0, 1], empty: true };

  let tMin = input.domain?.from ?? Math.min(...all.map((p) => p.t));
  let tMax = input.domain?.to ?? Math.max(...all.map((p) => p.t));
  if (!Number.isFinite(tMin)) tMin = Math.min(...all.map((p) => p.t));
  if (tMin === tMax) { tMin -= 43_200_000; tMax += 43_200_000; }

  const vals = all.map((p) => p.v).concat((input.refLines ?? []).map((r) => r.v));
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const X = (t: number) => m.l + ((t - tMin) / (tMax - tMin)) * (width - m.l - m.r);
  const Y = (v: number) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (height - m.t - m.b);

  const points: ChartPoint[] = [];
  const paths = series.map((s) => {
    const sorted = [...s.pts].sort((a, b) => a.t - b.t);
    sorted.forEach((p) => points.push({ x: X(p.t), y: Y(p.v), id: p.id, v: p.v, t: p.t, interp: p.interp, seriesKey: s.key }));
    const d = sorted.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(" ");
    return { key: s.key, role: s.role, d };
  });
  const xTicks = [0, 1, 2, 3, 4].map((i) => { const t = tMin + ((tMax - tMin) * i) / 4; return { x: X(t), t }; });
  return {
    paths, points, empty: false, yDomain: [yMin, yMax],
    yTicks: ticks.map((v) => ({ y: Y(v), label: String(v) })),
    xTicks,
    refLines: (input.refLines ?? []).map((r) => ({ y: Y(r.v), label: r.label })),
  };
}
