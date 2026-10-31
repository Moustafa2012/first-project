"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SpecialtyIcon } from "@/components/Icon";
import { Activity, AlertTriangle, CalendarDays, ClipboardList, FileText, FlaskConical, FolderHeart, HeartPulse, History, Home, Layers, NotebookPen, Pill, ScanLine, Scissors, Smile, Menu, ShieldCheck, Share2, X, Stethoscope, Syringe, TestTube2, UserRound, Users, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "": Home, profile: UserRound, timeline: History, conditions: HeartPulse, allergies: AlertTriangle, medications: Pill,
  "family-history": Users, immunizations: Syringe, vitals: Activity, labs: FlaskConical, "test-orders": TestTube2,
  visits: Stethoscope, procedures: Scissors, imaging: ScanLine, appointments: CalendarDays, "care-plans": ClipboardList,
  notes: NotebookPen, dental: Smile, specialties: Layers, documents: FileText, sharing: Share2, audit: ShieldCheck,
};
const iconFor = (href: string, root: string): LucideIcon => ICONS[href === root ? "" : href.slice(root.length + 1)] ?? FolderHeart;

/** `icon`: a specialty icon name (for the specialty files listed in the menu); `exact`: active only on that very page. */
export interface NavItem { href: string; label: string; short?: string; group?: string; icon?: string; exact?: boolean }

const isActive = (path: string, it: NavItem, root: string) => (it.href === root || it.exact ? path === it.href : path === it.href || path.startsWith(it.href + "/"));
const NavIcon = ({ it, root, size }: { it: NavItem; root: string; size: number }) => {
  if (it.icon) return <SpecialtyIcon name={it.icon} size={size} />;
  const I = iconFor(it.href, root);
  return <I size={size} aria-hidden="true" />;
};

function Links({ items, path, onNavigate }: { items: NavItem[]; path: string; onNavigate?: () => void }) {
  let last = "";
  const root = items[0].href;
  return (
    <>
      {items.map((it) => {
        const head = it.group && it.group !== last ? <div className="group" key={`g-${it.group}`}>{it.group}</div> : null;
        last = it.group ?? last;
        return (
          <span key={it.href} style={{ display: "contents" }}>
            {head}
            <Link href={it.href} aria-current={isActive(path, it, root) ? "page" : undefined} onClick={onNavigate}><NavIcon it={it} root={root} size={18} />{it.label}</Link>
          </span>
        );
      })}
    </>
  );
}

/** Desktop: sticky side list. Mobile: bottom tab bar with the four key sections and a "More" sheet with everything else. */
export function SideNav({ items, label, moreLabel = "More", closeLabel = "Close", primary = ["", "profile", "vitals", "documents"] }: { items: NavItem[]; label: string; moreLabel?: string; closeLabel?: string; primary?: string[] }) {
  const path = usePathname();
  const root = items[0].href;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);
  const tabs = primary.map((k) => items.find((it) => it.href === (k ? `${root}/${k}` : root))).filter((x): x is NavItem => !!x);
  const moreActive = !tabs.some((it) => isActive(path, it, root));
  return (
    <>
      <nav className="sidenav no-print" aria-label={label}><Links items={items} path={path} /></nav>
      <nav className="bottomnav no-print" aria-label={label}>
        {tabs.map((it) => {
          return <Link key={it.href} href={it.href} aria-current={isActive(path, it, root) ? "page" : undefined}><NavIcon it={it} root={root} size={22} /><span>{it.short ?? it.label}</span></Link>;
        })}
        <button type="button" className={moreActive ? "on" : ""} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={22} aria-hidden="true" /><span>{moreLabel}</span></button>
      </nav>
      {open && (
        <div className="sheet-wrap no-print" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" aria-hidden="true" />
            <div className="row between" style={{ marginBlockEnd: ".25rem" }}>
              <strong>{label}</strong>
              <button type="button" className="btn ghost sm" onClick={() => setOpen(false)} aria-label={closeLabel}><X size={18} aria-hidden="true" /></button>
            </div>
            <div className="sheet-links"><Links items={items} path={path} onNavigate={() => setOpen(false)} /></div>
          </div>
        </div>
      )}
    </>
  );
}
