"use client";

import { useFormState } from "react-dom";
import { CopyButton, SubmitButton, type FormAction } from "@/components/ui/client";

export interface InviteLabels { title: string; warn: string; link: string; copy: string; copied: string; email: string; access: string; viewer: string; editor: string; send: string; hint: string; another: string }

/** The invitation form; after it works it shows the one-time link (not kept anywhere in clear) to copy and pass on. */
export function InviteForm({ action, pid, labels: L }: { action: FormAction; pid: string; labels: InviteLabels }) {
  const [state, formAction] = useFormState(action, undefined);
  return (
    <div className="stack">
      {state?.ok && state.data?.link && (
        <div className="stack" role="status" data-testid="invite-link-box">
          <div className="banner ok"><div><strong>{L.title}</strong> <span className="ltr">{state.data.email}</span><br />{L.warn}</div></div>
          <div className="field"><span className="lab">{L.link}</span>
            <div className="row"><input readOnly value={state.data.link} dir="ltr" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 220 }} aria-label={L.link} data-testid="invite-link" />
              <CopyButton text={state.data.link} label={L.copy} done={L.copied} /></div></div>
        </div>
      )}
      <form action={formAction} className="stack">
        <input type="hidden" name="_pid" value={pid} />
        <div className="grid cols-2">
          <div className="field"><label htmlFor="inv_email">{L.email}</label><input id="inv_email" name="email" type="email" required dir="ltr" autoComplete="off" maxLength={254} /></div>
          <div className="field"><label htmlFor="inv_access">{L.access}</label>
            <select id="inv_access" name="access" defaultValue="viewer"><option value="viewer">{L.viewer}</option><option value="editor">{L.editor}</option></select></div>
        </div>
        <p className="muted small">{L.hint}</p>
        <div aria-live="polite">{state?.error && <p className="form-msg err" role="alert">{state.error}</p>}</div>
        <div><SubmitButton>{state?.ok ? L.another : L.send}</SubmitButton></div>
      </form>
    </div>
  );
}
