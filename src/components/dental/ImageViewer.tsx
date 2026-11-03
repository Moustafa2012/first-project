"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFormState } from "react-dom";
import {
  Circle, Columns2, Eye, EyeOff, Hand, MoveUpRight, RefreshCcw, RotateCcw, RotateCw, Save, Square, Type, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import type { Lang } from "@/lib/i18n";
import {
  ANNOTATION_COLORS, INITIAL_VIEW, clamp01, rotateBy, toNormalized, zoomAt, type AnnotationColor, type AnnotationRow, type Shape, type View,
} from "@/lib/dental-imaging";
import type { FormAction, FormState } from "@/components/ui/client";
import { ActionForm, ConfirmButton } from "@/components/ui/client";

/** An image file of a study the viewer can open (a jpg, png or webp document linked to an imaging study). */
export interface ViewerDoc { id: string; title: string; imaging_id: string; label: string }
/** What the viewer may do with annotations here: add (patient, or a doctor whose link allows it) and invalidate/withdraw. */
export interface ViewerAnnotations {
  rows: AnnotationRow[];
  add?: FormAction; addHidden?: Record<string, string>;
  /** the action that invalidates (patient) or withdraws (doctor) an annotation, its fixed fields, and which rows it may be used on */
  remove?: FormAction; removeHidden?: Record<string, string>; removeMineOnly?: boolean;
}

const COLOR: Record<AnnotationColor, string> = { red: "#ef4444", yellow: "#facc15", green: "#22c55e", blue: "#3b82f6", white: "#ffffff" };
const COLOR_NAME: Record<AnnotationColor, [string, string]> = {
  red: ["أحمر", "Red"], yellow: ["أصفر", "Yellow"], green: ["أخضر", "Green"], blue: ["أزرق", "Blue"], white: ["أبيض", "White"],
};
type Tool = "pan" | "arrow" | "circle" | "rect" | "text";

/** Draws one shape in the image's own pixel space (its box at zoom 1); strokes keep their screen width at any zoom. */
function ShapeSvg({ s, W, H, zoom, dashed }: { s: Shape; W: number; H: number; zoom: number; dashed?: boolean }) {
  const col = COLOR[s.color ?? "red"];
  const common = { stroke: col, strokeWidth: 2.5, fill: "none", vectorEffect: "non-scaling-stroke" as const, strokeDasharray: dashed ? "6 4" : undefined };
  switch (s.type) {
    case "arrow": {
      const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H;
      const a = Math.atan2(y2 - y1, x2 - x1), hs = 14 / zoom;
      const p = (d: number) => `${x2 - hs * Math.cos(a + d)},${y2 - hs * Math.sin(a + d)}`;
      return <g><line x1={x1} y1={y1} x2={x2} y2={y2} {...common} /><polyline points={`${p(0.45)} ${x2},${y2} ${p(-0.45)}`} {...common} /></g>;
    }
    case "circle": return <ellipse cx={s.cx * W} cy={s.cy * H} rx={s.r * W} ry={s.r * W} {...common} />;
    case "rect": return <rect x={s.x * W} y={s.y * H} width={s.w * W} height={s.h * H} {...common} />;
    case "text":
      return <text x={s.x * W} y={s.y * H} fontSize={16 / zoom} fill={col} stroke="#000" strokeWidth={0.6} paintOrder="stroke" fontWeight={700}>{s.text}</text>;
  }
}

function shapeFrom(tool: Tool, a: { x: number; y: number }, b: { x: number; y: number }, box: { w: number; h: number }, color: AnnotationColor): Shape | null {
  const q = (n: number) => Math.round(n * 10000) / 10000;
  if (tool === "arrow") return Math.hypot((b.x - a.x) * box.w, (b.y - a.y) * box.h) < 6 ? null : { type: "arrow", x1: q(a.x), y1: q(a.y), x2: q(b.x), y2: q(b.y), color };
  if (tool === "circle") {
    const r = Math.hypot((b.x - a.x) * box.w, (b.y - a.y) * box.h) / box.w;
    return r * box.w < 4 ? null : { type: "circle", cx: q(a.x), cy: q(a.y), r: q(Math.min(1, r)), color };
  }
  if (tool === "rect") {
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    return w * box.w < 4 || h * box.h < 4 ? null : { type: "rect", x: q(Math.min(a.x, b.x)), y: q(Math.min(a.y, b.y)), w: q(w), h: q(h), color };
  }
  return null;
}

interface PaneProps {
  doc: ViewerDoc; docBase: string; lang: Lang; shapes: AnnotationRow[]; showShapes: boolean;
  /** drawing is enabled on this pane (the primary one, when the user may add annotations) */
  tool: Tool; color: AnnotationColor; draft: Shape[]; onAdd?: (s: Shape) => void;
}

/** One image with zoom (wheel, buttons, pinch), pan (drag), rotation, brightness/contrast, and the annotations over it. */
function Pane({ doc, docBase, lang, shapes, showShapes, tool, color, draft, onAdd }: PaneProps) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [bright, setBright] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [vp, setVp] = useState({ w: 600, h: 400 });
  const [live, setLive] = useState<Shape | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const vpRef = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "draw" | "pinch"; start?: { x: number; y: number }; last?: { x: number; y: number }; d?: number } | null>(null);

  useEffect(() => { setView(INITIAL_VIEW); setBright(100); setContrast(100); setNat(null); setFailed(false); setLive(null); setTextAt(null); }, [doc.id]);

  // the viewport's size follows the window
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // the image box at zoom 1: the whole image fits in the viewport
  const box = useMemo(() => {
    if (!nat) return { w: vp.w, h: vp.h };
    const k = Math.min(vp.w / nat.w, vp.h / nat.h);
    return { w: Math.max(1, nat.w * k), h: Math.max(1, nat.h * k) };
  }, [nat, vp]);

  const rel = (e: { clientX: number; clientY: number }) => {
    const r = vpRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };
  const norm = (p: { x: number; y: number }) => { const n = toNormalized(p.x, p.y, box, view); return { x: clamp01(n.x), y: clamp01(n.y) }; };

  // the wheel zooms about the pointer; it must not scroll the page, so it cannot be a passive React handler
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e) => { e.preventDefault(); const p = rel(e); setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), p.x, p.y)); };
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const down = (e: React.PointerEvent) => {
    if (textAt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = rel(e);
    pts.current.set(e.pointerId, p);
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      gesture.current = { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) };
      setLive(null);
    } else if (tool === "pan" || !onAdd) {
      gesture.current = { kind: "pan", last: p };
    } else {
      const n = norm(p);
      gesture.current = { kind: "draw", start: n };
      if (tool === "text") setLive(null);
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    const p = rel(e);
    pts.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.d && d > 0) { const factor = d / g.d; setView((v) => zoomAt(v, factor, (a.x + b.x) / 2, (a.y + b.y) / 2)); g.d = d; }
    } else if (g.kind === "pan" && g.last) {
      const dx = p.x - g.last.x, dy = p.y - g.last.y;
      g.last = p;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (g.kind === "draw" && g.start && tool !== "text") {
      setLive(shapeFrom(tool, g.start, norm(p), box, color));
    }
  };
  const up = (e: React.PointerEvent) => {
    const g = gesture.current;
    const p = rel(e);
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2 && g?.kind === "pinch") gesture.current = null;
    if (g?.kind === "draw" && g.start && onAdd) {
      if (tool === "text") {
        const r = vpRef.current!.getBoundingClientRect();
        setTextAt({ x: g.start.x, y: g.start.y, sx: e.clientX - r.left, sy: e.clientY - r.top });
      } else {
        const s = shapeFrom(tool, g.start, norm(p), box, color);
        if (s) onAdd(s);
      }
      setLive(null);
    }
    if (pts.current.size === 0) gesture.current = null;
  };

  const key = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = 40;
    const c = (fn: (v: View) => View) => { e.preventDefault(); setView(fn); };
    if (e.key === "+" || e.key === "=") c((v) => zoomAt(v, 1.25, 0, 0));
    else if (e.key === "-" || e.key === "_") c((v) => zoomAt(v, 0.8, 0, 0));
    else if (e.key === "ArrowLeft") c((v) => ({ ...v, tx: v.tx + step }));
    else if (e.key === "ArrowRight") c((v) => ({ ...v, tx: v.tx - step }));
    else if (e.key === "ArrowUp") c((v) => ({ ...v, ty: v.ty + step }));
    else if (e.key === "ArrowDown") c((v) => ({ ...v, ty: v.ty - step }));
    else if (e.key === "r" || e.key === "R") c((v) => rotateBy(v, e.shiftKey ? -90 : 90));
    else if (e.key === "0") c(() => INITIAL_VIEW);
  };

  const btn = (label: string, icon: React.ReactNode, on: () => void) => (
    <button type="button" className="btn ghost sm iv-btn" onClick={on} aria-label={label} title={label}>{icon}</button>
  );
  const commitText = (value: string) => {
    const v = value.trim();
    if (v && textAt && onAdd) onAdd({ type: "text", x: Math.round(textAt.x * 10000) / 10000, y: Math.round(textAt.y * 10000) / 10000, text: v.slice(0, 200), color });
    setTextAt(null);
  };

  return (
    <div className="iv-pane">
      <div className="iv-pane-bar" role="toolbar" aria-label={t("أدوات الصورة", "Image tools")}>
        {btn(t("تكبير", "Zoom in"), <ZoomIn size={16} aria-hidden="true" />, () => setView((v) => zoomAt(v, 1.25, 0, 0)))}
        {btn(t("تصغير", "Zoom out"), <ZoomOut size={16} aria-hidden="true" />, () => setView((v) => zoomAt(v, 0.8, 0, 0)))}
        {btn(t("تدوير 90° يميناً", "Rotate 90° clockwise"), <RotateCw size={16} aria-hidden="true" />, () => setView((v) => rotateBy(v, 90)))}
        {btn(t("تدوير 90° يساراً", "Rotate 90° counter-clockwise"), <RotateCcw size={16} aria-hidden="true" />, () => setView((v) => rotateBy(v, -90)))}
        {btn(t("إعادة الضبط", "Reset"), <RefreshCcw size={16} aria-hidden="true" />, () => { setView(INITIAL_VIEW); setBright(100); setContrast(100); })}
        <span className="muted small ltr iv-zoom" aria-live="off">{Math.round(view.zoom * 100)}%</span>
        <label className="iv-slider"><span>{t("السطوع", "Brightness")}</span>
          <input type="range" min={30} max={250} value={bright} onChange={(e) => setBright(Number(e.target.value))} aria-label={t("السطوع", "Brightness")} /></label>
        <label className="iv-slider"><span>{t("التباين", "Contrast")}</span>
          <input type="range" min={30} max={300} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} aria-label={t("التباين", "Contrast")} /></label>
      </div>
      <div ref={vpRef} className={`iv-viewport tool-${tool}`} tabIndex={0} role="application" onKeyDown={key}
        aria-label={t(`${doc.label}. أسهم للتحريك، + و − للتكبير، R للتدوير، 0 لإعادة الضبط.`, `${doc.label}. Arrow keys pan, + and − zoom, R rotates, 0 resets.`)}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {failed ? <p className="iv-fail">{t("تعذر تحميل الصورة.", "The image could not be loaded.")}</p> : (
          <div className="iv-stage" style={{
            width: box.w, height: box.h, left: "50%", top: "50%", marginLeft: -box.w / 2, marginTop: -box.h / 2,
            transform: `translate(${view.tx}px, ${view.ty}px) rotate(${view.rotate}deg) scale(${view.zoom})`,
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${docBase}${doc.id}`} alt={doc.label} draggable={false} style={{ filter: `brightness(${bright}%) contrast(${contrast}%)` }}
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
            <svg className="iv-overlay-svg" viewBox={`0 0 ${box.w} ${box.h}`} width={box.w} height={box.h} aria-hidden="true">
              {showShapes && shapes.map((a) => a.shapes.map((s, i) => <ShapeSvg key={`${a.id}-${i}`} s={s} W={box.w} H={box.h} zoom={view.zoom} />))}
              {draft.map((s, i) => <ShapeSvg key={`d${i}`} s={s} W={box.w} H={box.h} zoom={view.zoom} dashed />)}
              {live && <ShapeSvg s={live} W={box.w} H={box.h} zoom={view.zoom} dashed />}
            </svg>
          </div>
        )}
        {textAt && (
          <input className="iv-text-input" autoFocus style={{ left: textAt.sx, top: textAt.sy }} maxLength={200} dir="auto"
            aria-label={t("نص التعليق، ثم Enter", "Annotation text, then Enter")} placeholder={t("اكتب ثم Enter", "Type, then Enter")}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitText(e.currentTarget.value); } else if (e.key === "Escape") { e.stopPropagation(); setTextAt(null); } }}
            onBlur={(e) => commitText(e.currentTarget.value)} />
        )}
      </div>
    </div>
  );
}

/**
 * Opens an image file of a study in a window of its own: zoom, pan, rotate, brightness and contrast (CSS filters, so the
 * file is never changed), a side-by-side comparison with another image of the same patient, and annotations drawn as an
 * SVG overlay and stored apart from the file. No libraries.
 */
export function ImageViewer({ docs, startId, docBase, lang, annotations, onClose }: {
  docs: ViewerDoc[]; startId: string; docBase: string; lang: Lang; annotations: ViewerAnnotations; onClose: () => void;
}) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const [primary, setPrimary] = useState(startId);
  const [second, setSecond] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pan");
  const [color, setColor] = useState<AnnotationColor>("red");
  const [draft, setDraft] = useState<Shape[]>([]);
  const [show, setShow] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [state, addAction] = useFormState<FormState, FormData>(annotations.add ?? (async () => undefined), undefined);

  const doc = docs.find((d) => d.id === primary) ?? docs[0];
  const other = second ? docs.find((d) => d.id === second) ?? null : null;
  const canDraw = Boolean(annotations.add);
  const mine = annotations.rows.filter((a) => a.document_id === doc?.id);

  useEffect(() => {
    opener.current = document.activeElement;
    dialogRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; (opener.current as HTMLElement | null)?.focus?.(); };
  }, []);
  // Escape closes the viewer wherever the focus is (it can be lost when a button is disabled after saving)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  useEffect(() => { if (state?.ok) setDraft([]); }, [state]);
  useEffect(() => { setDraft([]); }, [primary]);

  if (!doc) return null;
  const toolBtn = (id: Tool, label: string, icon: React.ReactNode) => (
    <button type="button" className={`btn sm iv-btn${tool === id ? " primary" : " ghost"}`} aria-pressed={tool === id} onClick={() => setTool(id)} aria-label={label} title={label}>{icon}</button>
  );

  // in the page body, outside the chart's own layout (it opens only after a click, so it is never rendered on the server)
  return createPortal(
    <div className="iv-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="iv-dialog" role="dialog" aria-modal="true" aria-label={t("عارض الصور", "Image viewer")} tabIndex={-1} ref={dialogRef}>
        <div className="iv-head">
          <strong className="iv-title">{doc.label}</strong>
          <div className="row" style={{ gap: ".35rem" }}>
            <button type="button" className={`btn sm iv-btn${other ? " primary" : " ghost"}`} aria-pressed={Boolean(other)} aria-label={t("مقارنة بصورة أخرى", "Compare with another image")}
              title={t("مقارنة بصورة أخرى", "Compare with another image")}
              onClick={() => setSecond(other ? null : (docs.find((d) => d.id !== doc.id)?.id ?? null))} disabled={docs.length < 2}><Columns2 size={16} aria-hidden="true" /></button>
            <button type="button" className="btn ghost sm iv-btn" onClick={onClose} aria-label={t("إغلاق", "Close")} title={t("إغلاق (Esc)", "Close (Esc)")}><X size={16} aria-hidden="true" /></button>
          </div>
        </div>

        <div className="iv-tools">
          <label className="iv-pick"><span className="sr-only">{t("الصورة", "Image")}</span>
            <select value={doc.id} onChange={(e) => setPrimary(e.target.value)} aria-label={t("الصورة المعروضة", "Image shown")}>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
          {other && (
            <label className="iv-pick"><span className="small muted">{t("تقارن مع", "Compared with")}</span>
              <select value={other.id} onChange={(e) => setSecond(e.target.value)} aria-label={t("الصورة المقارَنة", "Image to compare with")}>
                {docs.filter((d) => d.id !== doc.id).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
          )}
          {canDraw && (
            <div className="iv-draw" role="group" aria-label={t("أدوات التعليق", "Annotation tools")}>
              {toolBtn("pan", t("تحريك", "Pan"), <Hand size={16} aria-hidden="true" />)}
              {toolBtn("arrow", t("سهم", "Arrow"), <MoveUpRight size={16} aria-hidden="true" />)}
              {toolBtn("circle", t("دائرة", "Circle"), <Circle size={16} aria-hidden="true" />)}
              {toolBtn("rect", t("مستطيل", "Rectangle"), <Square size={16} aria-hidden="true" />)}
              {toolBtn("text", t("نص", "Text"), <Type size={16} aria-hidden="true" />)}
              <select value={color} onChange={(e) => setColor(e.target.value as AnnotationColor)} aria-label={t("لون الرسم", "Drawing colour")}>
                {ANNOTATION_COLORS.map((c) => <option key={c} value={c}>{COLOR_NAME[c][ar ? 0 : 1]}</option>)}</select>
            </div>
          )}
          <button type="button" className="btn ghost sm iv-btn" aria-pressed={show} onClick={() => setShow((v) => !v)}
            aria-label={show ? t("إخفاء التعليقات", "Hide annotations") : t("إظهار التعليقات", "Show annotations")} title={show ? t("إخفاء التعليقات", "Hide annotations") : t("إظهار التعليقات", "Show annotations")}>
            {show ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}</button>
        </div>

        <div className={`iv-panes${other ? " two" : ""}`}>
          <Pane doc={doc} docBase={docBase} lang={lang} shapes={mine} showShapes={show} tool={canDraw ? tool : "pan"} color={color} draft={draft}
            onAdd={canDraw ? (s) => setDraft((d) => (d.length >= 50 ? d : [...d, s])) : undefined} />
          {other && <Pane doc={other} docBase={docBase} lang={lang} shapes={annotations.rows.filter((a) => a.document_id === other.id)} showShapes={show} tool="pan" color={color} draft={[]} />}
        </div>

        {canDraw && (
          <form action={addAction} className="iv-save row" style={{ gap: ".5rem" }}>
            {Object.entries(annotations.addHidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="imaging_id" value={doc.imaging_id} /><input type="hidden" name="document_id" value={doc.id} />
            <input type="hidden" name="shapes" value={JSON.stringify(draft)} />
            <span className="small muted">{draft.length ? t(`${draft.length} شكل بانتظار الحفظ`, `${draft.length} shape(s) waiting to be saved`) : t("اختر أداة وارسم على الصورة، ثم احفظ.", "Choose a tool, draw on the image, then save.")}</span>
            <button type="button" className="btn ghost sm" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}><Undo2 size={14} aria-hidden="true" />{t("تراجع", "Undo")}</button>
            <button type="submit" className="btn primary sm" disabled={!draft.length}><Save size={14} aria-hidden="true" />{t("حفظ التعليق", "Save the annotation")}</button>
            <span aria-live="polite" className="small">
              {state?.error && <span className="form-msg err" role="alert">{state.error}</span>}
              {state?.ok && state.message && <span className="form-msg ok">{state.message}</span>}
            </span>
          </form>
        )}

        {mine.length > 0 && (
          <details className="iv-list">
            <summary>{t(`تعليقات هذه الصورة (${mine.length})`, `Annotations on this image (${mine.length})`)}</summary>
            <ul>
              {mine.map((a) => (
                <li key={a.id} className="row between">
                  <span>{a.shapes.length} {t("شكل", "shape(s)")}{a.by ? ` · ${a.by}` : ""}{a.recorded_at ? ` · ${a.recorded_at.slice(0, 10)}` : ""}</span>
                  {annotations.remove && (!annotations.removeMineOnly || a.mine) && (
                    <ActionForm action={annotations.remove} className="row" resetOnSuccess>
                      {Object.entries(annotations.removeHidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                      <input type="hidden" name="_id" value={a.id} />
                      <input name="reason" required minLength={3} maxLength={400} placeholder={t("السبب", "Reason")} aria-label={t("سبب الإبطال", "Reason")} />
                      <ConfirmButton message={t("إبطال هذا التعليق؟ يبقى في التاريخ مع السبب.", "Invalidate this annotation? It stays in the history with the reason.")}>{t("إبطال", "Invalidate")}</ConfirmButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>,
    document.body,
  );
}