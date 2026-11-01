"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { CopyButton, type FormAction } from "@/components/ui/client";
import { qrPath } from "@/lib/qr";

interface Labels {
  title: string; warn: string; link: string; pin: string; copy: string; copied: string; expires: string; done: string; hidePin: string; showPin: string;
  /** QR code of the link (never of the PIN) and the WhatsApp message */
  qr: string; qrHint: string; whatsapp: string; whatsappText: string; pinSeparate: string;
}

/** The share link as a QR code (black on white in both themes). The PIN is not part of it. */
export function LinkQr({ link, label }: { link: string; label: string }) {
  let code: { size: number; d: string } | null = null;
  try { code = qrPath(link); } catch { code = null; }        // a link longer than 213 bytes cannot be encoded: no code, the link still works
  if (!code) return null;
  return (
    <div className="qr-box" data-testid="share-qr">
      <svg viewBox={`0 0 ${code.size} ${code.size}`} role="img" aria-label={label} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
        <rect width={code.size} height={code.size} fill="#fff" /><path d={code.d} fill="#000" />
      </svg>
    </div>
  );
}

/** Shows the link + PIN exactly once, right after creation. They are never stored in clear or re-displayed. */
export function ShareCreateShell({ action, children, labels }: { action: FormAction; children: React.ReactNode; labels: Labels }) {
  const [state, formAction] = useFormState(action, undefined);
  const [reveal, setReveal] = useState(false);
  if (state?.ok && state.data) {
    const d = state.data;
    return (
      <div className="stack" role="status">
        <div className="banner ok"><div><strong>{labels.title}</strong><br />{labels.warn}</div></div>
        <div className="field"><span className="lab">{labels.link}</span>
          <div className="row"><input readOnly value={d.link} dir="ltr" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 220 }} aria-label={labels.link} /><CopyButton text={d.link} label={labels.copy} done={labels.copied} /></div></div>
        <div className="field"><span className="lab">{labels.pin}</span>
          <div className="row"><input readOnly value={reveal ? d.pin : "••••••"} dir="ltr" className="pin-input" style={{ maxWidth: 260 }} aria-label={labels.pin} />
            <button type="button" className="btn sm" onClick={() => setReveal(!reveal)}>{reveal ? labels.hidePin : labels.showPin}</button>
            <CopyButton text={d.pin} label={labels.copy} done={labels.copied} /></div></div>
        <div className="share-qr">
          <LinkQr link={d.link} label={labels.qr} />
          <div className="qr-side">
            <strong>{labels.qr}</strong>
            <p className="muted small" style={{ margin: 0 }}>{labels.qrHint}</p>
            <div className="row">
              <a className="btn" id="share-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(`${labels.whatsappText}\n${d.link}`)}`} target="_blank" rel="noopener noreferrer">{labels.whatsapp}</a>
            </div>
            <p className="small warn-text" style={{ margin: 0 }}>{labels.pinSeparate}</p>
          </div>
        </div>
        <p className="muted small">{labels.expires}: <span className="ltr">{d.expires}</span></p>
        <a className="btn primary" href={d.manageHref}>{labels.done}</a>
      </div>
    );
  }
  return (
    <form action={formAction} className="stack">
      {children}
      <div aria-live="polite">{state?.error && <p className="form-msg err" role="alert">{state.error}</p>}</div>
    </form>
  );
}
