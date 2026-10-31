"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import type { Lang } from "@/lib/i18n";
import {
  GM_MAX, GM_MIN, PD_MAX, PERIO_ARCHES, calAt, depthTone, emptyTooth, furcationsOf, readSite, sideOrder, siteComplete, siteName, summarize,
  type Furcation, type PerioTooth, type Site,
} from "@/lib/perio";
import { toothName } from "@/lib/dental";
import type { FormAction, FormState } from "@/components/ui/client";
import { SubmitButton } from "@/components/ui/client";

/** what is typed, per tooth: numbers stay text while being typed ("-", "1" of "12") */
interface Edit {
  missing: boolean; implant: boolean; mobility: string;
  furc: Record<Furcation, string>;
  pd: string[]; gm: string[]; bop: boolean[]; plaque: boolean[]; supp: boolean[];
}
type Side = "buccal" | "lingual";
const blank6 = () => ["", "", "", "", "", ""];
const false6 = () => [false, false, false, false, false, false];
const txt = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function toEdit(t: PerioTooth | undefined, missing = false): Edit {
  return {
    missing: t ? t.missing : missing, implant: t?.implant ?? false, mobility: txt(t?.mobility),
    furc: { b: txt(t?.furcation_b), l: txt(t?.furcation_l), m: txt(t?.furcation_m), d: txt(t?.furcation_d) },
    pd: t?.pd ? t.pd.map(txt) : blank6(), gm: t?.gm ? t.gm.map(txt) : blank6(),
    bop: t?.bop ? t.bop.map(Boolean) : false6(), plaque: t?.plaque ? t.plaque.map(Boolean) : false6(), supp: t?.suppuration ? t.suppuration.map(Boolean) : false6(),
  };
}
const num = (s: string, lo: number, hi: number) => { const v = readSite(s, lo, hi); return v === "bad" ? null : v; };
const any6 = <T,>(a: T[], f: (v: T) => boolean) => a.some(f);
function toTooth(tooth: number, e: Edit): PerioTooth {
  const t = emptyTooth(tooth);
  t.missing = e.missing;
  if (e.missing) return t;
  t.implant = e.implant;
  t.mobility = num(e.mobility, 0, 3);
  for (const f of furcationsOf(tooth)) t[`furcation_${f}`] = num(e.furc[f], 0, 3);
  t.pd = any6(e.pd, (v) => v.trim() !== "") ? e.pd.map((v) => num(v, 0, PD_MAX)) : null;
  t.gm = any6(e.gm, (v) => v.trim() !== "") ? e.gm.map((v) => num(v, GM_MIN, GM_MAX)) : null;
  t.bop = any6(e.bop, Boolean) ? [...e.bop] : null;
  t.plaque = any6(e.plaque, Boolean) ? [...e.plaque] : null;
  t.suppuration = any6(e.supp, Boolean) ? [...e.supp] : null;
  return t;
}

// ---------------------------------------------------------------- the drawing of one side of one tooth
const MM = 3.2, CEJ = 8, H = 62;
/** gingival margin and attachment level of three sites; apical is down (the upper arch is flipped by its caller) */
export function PerioSvg({ tooth, side, t, flip, label }: { tooth: number; side: Side; t: PerioTooth | undefined; flip: boolean; label: string }) {
  const order = sideOrder(tooth, side);
  const xs = [10, 30, 50];
  const y = (mm: number) => CEJ + mm * MM;
  const pts = order.map((s, k) => {
    const pd = t?.pd?.[s], gm = t?.gm?.[s] ?? 0;
    return { x: xs[k], gm: y(-(gm)), base: pd === null || pd === undefined ? null : y(-(gm) + pd), tone: depthTone(pd), bop: !!t?.bop?.[s] };
  });
  const line = (k: "gm" | "base") => pts.filter((p) => p[k] !== null).map((p) => `${p.x},${p[k]}`).join(" ");
  return (
    <svg viewBox={`0 0 60 ${H}`} className="perio-svg" role="img" aria-label={label} preserveAspectRatio="none">
      <g transform={flip ? `translate(0 ${H}) scale(1 -1)` : undefined}>
        {t?.missing ? (
          <path d={`M8 ${CEJ} L52 ${H - 6} M52 ${CEJ} L8 ${H - 6}`} className="perio-missing" />
        ) : (<>
          <path d={`M14 ${CEJ} L18 ${H - 4} Q30 ${H + 2} 42 ${H - 4} L46 ${CEJ} Z`} className={t?.implant ? "perio-root implant" : "perio-root"} />
          <line x1="0" x2="60" y1={CEJ} y2={CEJ} className="perio-cej" />
          {pts.map((p, i) => p.base !== null && <line key={i} x1={p.x} x2={p.x} y1={p.gm} y2={p.base} className={`perio-pocket ${p.tone ?? ""}`} />)}
          {line("gm") && <polyline points={line("gm")} className="perio-gm" />}
          {line("base") && <polyline points={line("base")} className="perio-cal" />}
          {pts.map((p, i) => p.bop && p.base !== null && <circle key={`b${i}`} cx={p.x} cy={p.base} r="2.4" className="perio-bop-dot" />)}
        </>)}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------- the chart
export interface PerioChartProps {
  lang: Lang;
  teeth: PerioTooth[];
  /** editing a draft: the save action and the exam's header; omit to show a chart read-only */
  edit?: {
    action: FormAction; hidden: Record<string, string>; examId: string | null; today: string; seedMissing: number[];
    header: { exam_date: string; examiner_name: string; facility_name: string; notes: string };
  };
}

export function PerioChart({ lang, teeth, edit }: PerioChartProps) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const readOnly = !edit;
  const initial = useMemo(() => {
    const by = new Map(teeth.map((x) => [x.tooth, x]));
    const seed = new Set(edit && !edit.examId ? edit.seedMissing : []);
    const out: Record<number, Edit> = {};
    for (const n of [...PERIO_ARCHES.upper, ...PERIO_ARCHES.lower]) out[n] = toEdit(by.get(n), seed.has(n));
    return out;
  }, [teeth, edit]);
  const [state, setState] = useState(initial);
  const [auto, setAuto] = useState(true);
  // the redirect after finalising happens as soon as the action answers: the revalidation that comes with the answer
  // unmounts this editor (the draft is gone), before any effect would run
  const [form, formAction] = useFormState<FormState, FormData>(async (prev: FormState, fd: FormData) => {
    const r = edit ? await edit.action(prev, fd) : undefined;
    const to = r?.redirectTo;
    if (to && to.startsWith("/") && !to.startsWith("//")) window.location.assign(to);
    return r;
  }, undefined);
  const finalizeRef = useRef<HTMLInputElement>(null);
  const [examId, setExamId] = useState(edit?.examId ?? "");
  useEffect(() => {
    if (finalizeRef.current) finalizeRef.current.value = "0";   // a refused "finalise" must not turn the next draft save into one
    if (form?.ok && form.data?.id) setExamId(form.data.id);
  }, [form]);
  useEffect(() => { setState(initial); }, [initial]);

  const model = useMemo(() => {
    const out = new Map<number, PerioTooth>();
    for (const [k, v] of Object.entries(state)) out.set(Number(k), toTooth(Number(k), v));
    return out;
  }, [state]);
  const summary = useMemo(() => summarize([...model.values()]), [model]);
  const payload = useMemo(() => JSON.stringify([...model.values()].filter((x) => x.missing || x.implant || x.pd || x.gm || x.bop || x.plaque
    || x.suppuration || x.mobility !== null || [x.furcation_b, x.furcation_l, x.furcation_m, x.furcation_d].some((f) => f !== null))), [model]);

  const set = (tooth: number, f: (e: Edit) => Edit) => setState((s) => ({ ...s, [tooth]: f(s[tooth]) }));
  const focusNext = (row: string, i: number) => {
    for (let k = i + 1; k < 48; k++) {
      const el = document.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-i="${k}"]`);
      if (el && !el.disabled) { el.focus(); el.select(); return; }
    }
  };
  const onSite = (row: string, i: number, tooth: number, kind: "pd" | "gm", site: Site, v: string) => {
    if (!/^[-+]?\d{0,2}$/.test(v)) return;
    set(tooth, (e) => { const a = [...e[kind]]; a[site] = v; return { ...e, [kind]: a }; });
    if (auto && siteComplete(v, kind === "pd")) focusNext(row, i);
  };
  const onKey = (row: string, i: number) => (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); focusNext(row, i); }
  };

  const arch = (which: "upper" | "lower") => {
    const list = PERIO_ARCHES[which];
    const upper = which === "upper";
    const sides: Side[] = upper ? ["buccal", "lingual"] : ["lingual", "buccal"];
    const sideLabel = (s: Side) => (s === "buccal" ? t("الدهليزي", "Buccal") : upper ? t("الحنكي", "Palatal") : t("اللساني", "Lingual"));
    const cellsPerTooth = (render: (tooth: number, e: Edit, m: PerioTooth | undefined) => React.ReactNode, cls = "") =>
      list.map((n) => <td key={n} colSpan={3} className={`pc-tooth ${cls}${state[n].missing ? " is-missing" : ""}`}>{render(n, state[n], model.get(n))}</td>);
    const siteRow = (side: Side, kind: "pd" | "gm" | "cal" | "bop" | "plaque" | "supp", label: string) => {
      const row = `${which}-${side}-${kind}`;
      // a final chart shows only the rows that hold something
      if (readOnly && kind !== "pd" && kind !== "cal") {
        const has = list.some((n) => sideOrder(n, side).some((s) => {
          const e = state[n];
          return kind === "gm" ? e.gm[s].trim() !== "" && e.gm[s] !== "0" : e[kind][s];
        }));
        if (!has) return null;
      }
      return (
        <tr key={row} className={`pc-row pc-${kind}`}>
          <th scope="row">{label}</th>
          {list.map((n, ti) => sideOrder(n, side).map((s, k) => {
            const e = state[n], m = model.get(n), i = ti * 3 + k, name = `${n} ${siteName(s, n, lang)}`;
            if (e.missing) return <td key={`${n}-${k}`} className="pc-site is-missing" />;
            if (kind === "cal") {
              const c = calAt(m?.pd?.[s], m?.gm?.[s]);
              return <td key={`${n}-${k}`} className={`pc-site pc-calv ${depthTone(c) ?? ""}`}>{c ?? ""}</td>;
            }
            if (kind === "bop" || kind === "plaque" || kind === "supp") {
              const on = e[kind][s];
              const what = kind === "bop" ? t("نزف", "bleeding") : kind === "plaque" ? t("بلاك", "plaque") : t("قيح", "suppuration");
              return (
                <td key={`${n}-${k}`} className="pc-site">
                  {readOnly ? (on ? <span className={`pc-dot ${kind} on`} role="img" aria-label={`${name}: ${what}`} /> : null) : (
                    <button type="button" className={`pc-dot ${kind}${on ? " on" : ""}`} aria-pressed={on} aria-label={`${name}: ${what}`}
                      onClick={() => set(n, (x) => { const a = [...x[kind]]; a[s] = !a[s]; return { ...x, [kind]: a }; })} />
                  )}
                </td>
              );
            }
            const v = e[kind][s];
            const bad = readSite(v, kind === "pd" ? 0 : GM_MIN, kind === "pd" ? PD_MAX : GM_MAX) === "bad";
            const tone = kind === "pd" ? depthTone(m?.pd?.[s]) : null;
            return (
              <td key={`${n}-${k}`} className={`pc-site ${tone ?? ""}`}>
                {readOnly ? <span>{v}</span> : (
                  <input value={v} inputMode="numeric" maxLength={3} autoComplete="off" data-row={row} data-i={i} aria-invalid={bad || undefined}
                    aria-label={`${name}: ${kind === "pd" ? t("عمق الجيب", "probing depth") : t("حافة اللثة", "gingival margin")}`}
                    onChange={(ev) => onSite(row, i, n, kind, s, ev.target.value)} onKeyDown={onKey(row, i)} onFocus={(ev) => ev.target.select()} />
                )}
              </td>
            );
          }))}
        </tr>
      );
    };
    const furcRow = (side: Side) => {
      const fs = (n: number): Furcation[] => furcationsOf(n).filter((f) => (side === "buccal" ? f === "b" : f !== "b"));
      if (!list.some((n) => fs(n).length)) return null;
      if (readOnly && !list.some((n) => fs(n).some((f) => state[n].furc[f] && state[n].furc[f] !== "0"))) return null;
      return (
        <tr key={`${which}-${side}-furc`} className="pc-row pc-furc">
          <th scope="row">{t("انقسام الجذور", "Furcation")}</th>
          {cellsPerTooth((n, e) => (e.missing ? null : fs(n).map((f) => {
            const lab = `${n} ${t("انقسام", "furcation")} ${f === "b" ? t("دهليزي", "buccal") : f === "l" ? t("لساني", "lingual") : f === "m" ? t("أنسي-حنكي", "mesiopalatal") : t("وحشي-حنكي", "distopalatal")}`;
            return readOnly ? (e.furc[f] && e.furc[f] !== "0" ? <span key={f} className="pc-furc-v" title={lab}>{f.toUpperCase()}{e.furc[f]}</span> : null) : (
              <select key={f} aria-label={lab} value={e.furc[f]} onChange={(ev) => set(n, (x) => ({ ...x, furc: { ...x.furc, [f]: ev.target.value } }))}>
                <option value="">{f.toUpperCase()}</option>{[0, 1, 2, 3].map((g) => <option key={g} value={g}>{f.toUpperCase()}{g}</option>)}
              </select>
            );
          })))}
        </tr>
      );
    };
    const svgRow = (side: Side) => (
      <tr key={`${which}-${side}-svg`} className="pc-row pc-graph">
        <th scope="row" className="pc-side-label">{sideLabel(side)}</th>
        {cellsPerTooth((n, _e, m) => <PerioSvg tooth={n} side={side} t={m} flip={upper} label={`${n} ${sideLabel(side)}`} />, "pc-graph-cell")}
      </tr>
    );
    const block = (side: Side, outerFirst: boolean) => {
      const rows = [
        furcRow(side),
        siteRow(side, "plaque", t("بلاك", "Plaque")),
        siteRow(side, "bop", t("نزف", "Bleeding")),
        siteRow(side, "supp", t("قيح", "Pus")),
        siteRow(side, "gm", t("حافة اللثة", "Margin")),
        siteRow(side, "pd", t("عمق الجيب", "Depth")),
        siteRow(side, "cal", t("الارتباط", "CAL")),
        svgRow(side),
      ];
      return outerFirst ? rows : rows.reverse();
    };
    const toothRow = (
      <tr key={`${which}-teeth`} className="pc-row pc-teeth">
        <th scope="row">{t("السن", "Tooth")}</th>
        {cellsPerTooth((n) => <strong title={toothName(n, lang)}>{n}</strong>)}
      </tr>
    );
    const flagRows = readOnly ? [
      list.some((n) => state[n].implant) && (
        <tr key={`${which}-implant`} className="pc-row pc-flags">
          <th scope="row">{t("زرعة", "Implant")}</th>
          {cellsPerTooth((n, e) => (e.implant ? "●" : null))}
        </tr>
      ),
      list.some((n) => state[n].mobility && state[n].mobility !== "0") && (
        <tr key={`${which}-mob`} className="pc-row pc-flags">
          <th scope="row">{t("الحركة", "Mobility")}</th>
          {cellsPerTooth((n, e) => (e.mobility && e.mobility !== "0" ? <span className="pc-mob">{e.mobility}</span> : null))}
        </tr>
      ),
    ] : [
      <tr key={`${which}-missing`} className="pc-row pc-flags">
        <th scope="row">{t("مفقود", "Missing")}</th>
        {cellsPerTooth((n, e) => (readOnly ? (e.missing ? "✕" : null) : (
          <input type="checkbox" checked={e.missing} aria-label={`${n}: ${t("مفقود", "missing")}`}
            onChange={(ev) => set(n, (x) => (ev.target.checked ? { ...toEdit(undefined, true) } : { ...x, missing: false }))} />)))}
      </tr>,
      <tr key={`${which}-implant`} className="pc-row pc-flags">
        <th scope="row">{t("زرعة", "Implant")}</th>
        {cellsPerTooth((n, e) => (e.missing ? null : readOnly ? (e.implant ? "●" : null) : (
          <input type="checkbox" checked={e.implant} aria-label={`${n}: ${t("زرعة", "implant")}`} onChange={(ev) => set(n, (x) => ({ ...x, implant: ev.target.checked }))} />)))}
      </tr>,
      <tr key={`${which}-mob`} className="pc-row pc-flags">
        <th scope="row">{t("الحركة", "Mobility")}</th>
        {cellsPerTooth((n, e) => (e.missing ? null : readOnly ? (e.mobility && e.mobility !== "0" ? <span className="pc-mob">{e.mobility}</span> : null) : (
          <select aria-label={`${n}: ${t("الحركة", "mobility")}`} value={e.mobility} onChange={(ev) => set(n, (x) => ({ ...x, mobility: ev.target.value }))}>
            <option value="">—</option>{[0, 1, 2, 3].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>)))}
      </tr>,
    ];
    return (
      <div className="table-wrap perio-wrap" key={which}>
        <table className="perio-chart" dir="ltr" aria-label={upper ? t("الفك العلوي", "Upper arch") : t("الفك السفلي", "Lower arch")}>
          <colgroup><col className="pc-label-col" />{list.map((n) => <Fragment key={n}><col /><col /><col /></Fragment>)}</colgroup>
          <tbody>
            {upper ? (<>{toothRow}{flagRows}{block(sides[0], true)}{block(sides[1], false)}</>)
              : (<>{block(sides[0], true)}{block(sides[1], false)}{[...flagRows].reverse()}{toothRow}</>)}
          </tbody>
        </table>
      </div>
    );
  };

  const stats = (
    <div className="perio-stats" aria-live="polite">
      {[
        [t("المواقع المسبورة", "Sites probed"), String(summary.sites)],
        [t("النزف عند السبر", "Bleeding on probing"), summary.bopPct === null ? "—" : `${summary.bopPct}%`],
        [t("البلاك", "Plaque"), summary.plaquePct === null ? "—" : `${summary.plaquePct}%`],
        [t("جيوب ≥ 4 مم", "Pockets ≥ 4 mm"), String(summary.pd4)],
        [t("جيوب ≥ 6 مم", "Pockets ≥ 6 mm"), String(summary.pd6)],
        [t("متوسط الارتباط", "Mean CAL"), summary.meanCal === null ? "—" : `${summary.meanCal} ${t("مم", "mm")}`],
        [t("أقصى فقد ارتباط", "Max CAL"), summary.maxCal === null ? "—" : `${summary.maxCal} ${t("مم", "mm")}`],
      ].map(([k, v]) => <div key={k} className="perio-stat"><span className="k">{k}</span><span className="v">{v}</span></div>)}
    </div>
  );

  const legend = (
    <p className="small muted perio-legend">
      <span className="lg ok" />{t("1–3 مم", "1–3 mm")} <span className="lg warn" />{t("4–5 مم", "4–5 mm")} <span className="lg deep" />{t("6 مم فأكثر", "6 mm +")}
      {" · "}<span className="lg gm" />{t("حافة اللثة", "gingival margin")} <span className="lg cal" />{t("مستوى الارتباط", "attachment level")}
      {" · "}{t("حافة اللثة: موجب = فوق ملتقى المينا بالملاط (تضخم)، سالب = انحسار. الارتباط = العمق − الحافة.",
        "Margin: positive = coronal to the CEJ (overgrowth), negative = recession. CAL = depth − margin.")}
    </p>
  );

  if (readOnly) return <div className="perio">{stats}{arch("upper")}{arch("lower")}{legend}</div>;

  const h = edit!.header;
  return (
    <form action={formAction} className="perio" id="perio-form">
      {Object.entries(edit!.hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="_id" value={examId} />
      <input type="hidden" name="teeth" value={payload} />
      <input type="hidden" name="_finalize" defaultValue="0" ref={finalizeRef} />
      <div className="grid cols-4 perio-head">
        <div className="field"><label htmlFor="pe-date">{t("تاريخ الفحص", "Exam date")}</label><input id="pe-date" name="exam_date" type="date" required max={edit!.today} defaultValue={h.exam_date} /></div>
        <div className="field"><label htmlFor="pe-examiner">{t("الفاحص", "Examiner")}</label><input id="pe-examiner" name="examiner_name" maxLength={200} defaultValue={h.examiner_name} /></div>
        <div className="field"><label htmlFor="pe-facility">{t("المنشأة", "Facility")}</label><input id="pe-facility" name="facility_name" maxLength={200} defaultValue={h.facility_name} /></div>
        <div className="field perio-auto"><label><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {t("انتقال تلقائي بعد كل رقم", "Move on after each digit")}</label>
          <span className="small muted">{t("Enter أو مسافة للانتقال يدوياً؛ بعد «1» في العمق انتظر رقماً ثانياً.", "Enter or space moves on; after “1” in depth, a second digit may follow.")}</span></div>
      </div>
      {stats}
      {arch("upper")}
      {arch("lower")}
      {legend}
      <div className="field"><label htmlFor="pe-notes">{t("ملاحظات", "Notes")}</label><textarea id="pe-notes" name="notes" rows={2} maxLength={4000} defaultValue={h.notes} /></div>
      <div aria-live="polite">
        {form?.error && <p className="form-msg err" role="alert">{form.error}</p>}
        {form?.ok && form.message && <p className="form-msg ok">{form.message}</p>}
      </div>
      <div className="row gap">
        <SubmitButton className="btn" pending={t("جارٍ الحفظ…", "Saving…")}>{t("حفظ المسودة", "Save draft")}</SubmitButton>
        <button type="submit" className="btn primary" onClick={(e) => {
          if (!window.confirm(t("بعد الاعتماد لا يُعدَّل المخطط (يمكن إبطاله بسبب فقط). اعتماد الآن؟", "A final chart is not edited (it can only be invalidated with a reason). Finalise now?"))) { e.preventDefault(); return; }
          if (finalizeRef.current) finalizeRef.current.value = "1";
        }}>{t("اعتماد المخطط", "Finalise the chart")}</button>
      </div>
    </form>
  );
}
