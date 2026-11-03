"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { ActionForm, CopyButton, SubmitButton, ConfirmButton } from "@/components/ui/client";
import { LinkQr } from "@/components/ShareCreateShell";
import { disableEmergency, enableEmergency, setEmergencyOptions } from "@/app/actions/care";

export interface EmergencyLabels {
  on: string; off: string; enable: string; regenerate: string; disable: string; confirmRegenerate: string; confirmDisable: string; sensitive: string; sensitiveHint: string;
  contacts: string; save: string; linkTitle: string; linkWarn: string; link: string; copy: string; copied: string; qr: string; pdfWithQr: string; print: string; hint: string;
}

/**
 * Turns the public emergency link on or off, regenerates it and sets what it shows. The link (and its QR) are shown right after
 * they are made and never again: only a hash of the token is stored, so the page cannot show it later.
 */
export function EmergencyPanel({ pid, enabled, includeSensitive, includeContacts, canManage, labels: L }: {
  pid: string; enabled: boolean; includeSensitive: boolean; includeContacts: boolean; canManage: boolean; labels: EmergencyLabels;
}) {
  const [made, makeAction] = useFormState(enableEmergency, undefined);
  const [shown, setShown] = useState(true);
  const link = made?.ok && made.data?.link && shown ? made.data : null;
  return (
    <div className="stack">
      <p className="row"><span className={`chip ${enabled ? "ok" : "muted"}`} data-testid="emergency-status">{enabled ? L.on : L.off}</span></p>
      {link && (
        <div className="stack no-print-keep" role="status" data-testid="emergency-link-box">
          <div className="banner warn"><div><strong>{L.linkTitle}</strong><br />{L.linkWarn}</div></div>
          <div className="field"><span className="lab">{L.link}</span>
            <div className="row"><input readOnly value={link.link} dir="ltr" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 220 }} aria-label={L.link} data-testid="emergency-link" />
              <CopyButton text={link.link} label={L.copy} done={L.copied} /></div></div>
          <div className="share-qr emergency-qr"><LinkQr link={link.link} label={L.qr} /></div>
          <div className="row">
            <form method="post" action={`/api/patients/${pid}/emergency/pdf`} target="_blank"><input type="hidden" name="token" value={link.token} /><button className="btn primary" type="submit">{L.pdfWithQr}</button></form>
            <button type="button" className="btn" onClick={() => window.print()}>{L.print}</button>
            <button type="button" className="btn ghost" onClick={() => setShown(false)}>×</button>
          </div>
        </div>
      )}
      {made?.error && <p className="form-msg err" role="alert">{made.error}</p>}
      {canManage && !enabled && (
        <form action={makeAction} className="stack">
          <input type="hidden" name="_pid" value={pid} />
          <label className="check"><input type="checkbox" name="include_contacts" defaultChecked={includeContacts} /> {L.contacts}</label>
          <label className="check"><input type="checkbox" name="include_sensitive" defaultChecked={includeSensitive} /> {L.sensitive}</label>
          <p className="muted small">{L.sensitiveHint}</p>
          <div><SubmitButton className="btn primary">{L.enable}</SubmitButton></div>
        </form>
      )}
      {canManage && enabled && (
        <>
          <ActionForm action={setEmergencyOptions} className="stack" resetOnSuccess={false}>
            <input type="hidden" name="_pid" value={pid} />
            <label className="check"><input type="checkbox" name="include_contacts" defaultChecked={includeContacts} /> {L.contacts}</label>
            <label className="check"><input type="checkbox" name="include_sensitive" defaultChecked={includeSensitive} /> {L.sensitive}</label>
            <p className="muted small">{L.sensitiveHint}</p>
            <div><SubmitButton className="btn">{L.save}</SubmitButton></div>
          </ActionForm>
          <div className="row">
            <form action={(fd) => { setShown(true); return makeAction(fd); }}>
              <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_regenerate" value="1" />
              <ConfirmButton message={L.confirmRegenerate} className="btn">{L.regenerate}</ConfirmButton>
            </form>
            <ActionForm action={disableEmergency} resetOnSuccess={false}>
              <input type="hidden" name="_pid" value={pid} />
              <ConfirmButton message={L.confirmDisable}>{L.disable}</ConfirmButton>
            </ActionForm>
          </div>
        </>
      )}
      <p className="muted small">{L.hint}</p>
    </div>
  );
}
