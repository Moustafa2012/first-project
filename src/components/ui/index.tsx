import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Check, CircleAlert, Inbox, Info, Minus } from "lucide-react";
import { INTERPRETATION, lbl, type Opt } from "@/lib/labels";
import type { Lang } from "@/lib/i18n";

export function Chip({ tone = "muted", children, title }: { tone?: "ok" | "warn" | "bad" | "info" | "muted"; children: React.ReactNode; title?: string }) {
  return <span className={`chip ${tone}`} title={title}>{children}</span>;
}

const ICONS = { check: Check, alert: AlertTriangle, up: ArrowUp, down: ArrowDown, dash: Minus };

/** Interpretation chip: icon + text + color, never color alone. */
export function InterpChip({ value, lang }: { value: string; lang: Lang }) {
  const m = INTERPRETATION[value] ?? INTERPRETATION.not_assessed;
  const I = ICONS[m.icon as keyof typeof ICONS];
  return <Chip tone={m.tone}><I size={13} aria-hidden="true" />{m[lang]}</Chip>;
}

export function Banner({ tone = "info", title, children }: { tone?: "bad" | "warn" | "ok" | "info"; title?: string; children?: React.ReactNode }) {
  const I = tone === "bad" || tone === "warn" ? CircleAlert : tone === "ok" ? Check : Info;
  return (
    <div className={`banner ${tone}`} role={tone === "bad" ? "alert" : "note"}>
      <I size={18} aria-hidden="true" style={{ flex: "none", marginBlockStart: 3 }} />
      <div>{title && <strong>{title}</strong>}{title && children ? " — " : null}{children}</div>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty"><span className="empty-icon" aria-hidden="true"><Inbox size={22} /></span><div>{children}</div></div>;
}

export function Card({ title, actions, children, id }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="card" id={id}>
      {(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions && <div className="row">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export function KV({ items }: { items: [string, React.ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return <dl className="kv">{shown.map(([k, v]) => (<><dt key={`k${k}`}>{k}</dt><dd key={`v${k}`}>{v}</dd></>))}</dl>;
}

export function OptSelect({ name, options, value, lang, required, blank }: { name: string; options: Opt[]; value?: string | null; lang: Lang; required?: boolean; blank?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} required={required} id={`f_${name}`}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}
    </select>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="btn ghost sm">{children}</Link>;
}

export { lbl };
