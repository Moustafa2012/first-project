"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { CopyButton, type FormAction } from "@/components/ui/client";

interface Labels { title: string; warn: string; link: string; pin: string; copy: string; copied: string; expires: string; done: string; hidePin: string; showPin: string }

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
