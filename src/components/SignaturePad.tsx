"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A handwritten signature drawn with a finger, pen or mouse. The drawing is submitted as a PNG data URL in a hidden
 * input called `name`; the field stays empty (and the form refuses to submit) until something has been drawn.
 */
export function SignaturePad({ name, label, clear, hint }: { name: string; label: string; clear: string; hint: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [value, setValue] = useState("");

  // crisp lines on high-density screens; the ink follows the theme's text colour
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * ratio);
    c.height = Math.round(height * ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0d1f2d";
  }, []);

  // a form reset (after a successful save) also empties the drawing
  useEffect(() => {
    const form = canvas.current?.closest("form");
    const clearAll = () => {
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); }
      setValue("");
    };
    form?.addEventListener("reset", clearAll);
    return () => form?.removeEventListener("reset", clearAll);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setValue(canvas.current?.toDataURL("image/png") ?? "");
  };
  const reset = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); }
    setValue("");
  };

  return (
    <div className="field wide">
      <span className="label-like">{label} <span className="req" aria-hidden="true">*</span></span>
      <canvas ref={canvas} className="sig-pad" role="img" aria-label={label}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      {/* required and empty until something is drawn, so the form cannot be submitted unsigned (not readOnly: browsers skip validating those) */}
      <input type="text" name={name} value={value} required tabIndex={-1} aria-hidden="true" className="sig-value" onChange={() => {}} />
      <div className="row between">
        <span className="hint">{hint}</span>
        <button type="button" className="btn sm" onClick={reset}>{clear}</button>
      </div>
    </div>
  );
}
