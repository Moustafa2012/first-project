"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";

export type FormState = { ok?: boolean; error?: string; message?: string; data?: Record<string, string> } | undefined;
export type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

export function SubmitButton({ children, className = "btn primary", pending: pendingText }: { children: React.ReactNode; className?: string; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Wraps a server action: shows its error/success message and clears the form after a successful save. */
export function ActionForm({
  action, children, className, resetOnSuccess = true, id,
}: { action: FormAction; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; id?: string }) {
  const [state, formAction] = useFormState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form action={formAction} ref={ref} className={className} id={id}>
      {children}
      <div aria-live="polite">
        {state?.error && <p className="form-msg err" role="alert">{state.error}</p>}
        {state?.ok && state.message && <p className="form-msg ok">{state.message}</p>}
      </div>
    </form>
  );
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(+d)) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local that submits an absolute ISO instant, so the viewer's own time zone is respected. */
export function DateTimeField({ name, defaultValue, required, blank }: { name: string; defaultValue?: string | null; required?: boolean; blank?: boolean }) {
  const [local, setLocal] = useState("");
  useEffect(() => { setLocal(defaultValue ? toLocalInput(defaultValue) : blank ? "" : toLocalInput(null)); }, [defaultValue, blank]);
  const iso = local ? new Date(local).toISOString() : "";
  return (
    <>
      <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} required={required} aria-label={name} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}

/** Remembers the browser time zone in a cookie so server-rendered times read correctly. */
export function TzSetter({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && tz !== current) {
        document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }
    } catch { /* ignore */ }
  }, [current, router]);
  return null;
}

export function ConfirmButton({ message, children, className = "btn danger sm" }: { message: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="submit" className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
    }}>
      {copied ? done : label}
    </button>
  );
}

export function PrintButton({ label }: { label: string }) {
  return <button type="button" className="btn sm" onClick={() => window.print()}>{label}</button>;
}
