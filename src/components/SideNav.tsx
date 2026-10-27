"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, AlertTriangle, CalendarDays, ClipboardList, FileText, FlaskConical, FolderHeart, HeartPulse, History, Home, Layers, NotebookPen, Pill, ScanLine, Scissors, ShieldCheck, Share2, Stethoscope, Syringe, TestTube2, UserRound, Users, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "": Home, profile: UserRound, timeline: History, conditions: HeartPulse, allergies: AlertTriangle, medications: Pill,
  "family-history": Users, immunizations: Syringe, vitals: Activity, labs: FlaskConical, "test-orders": TestTube2,
  visits: Stethoscope, procedures: Scissors, imaging: ScanLine, appointments: CalendarDays, "care-plans": ClipboardList,
  notes: NotebookPen, specialties: Layers, documents: FileText, sharing: Share2, audit: ShieldCheck,
};
const iconFor = (href: string, root: string): LucideIcon => ICONS[href === root ? "" : href.slice(root.length + 1)] ?? FolderHeart;

export interface NavItem { href: string; label: string; group?: string }

export function SideNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname();
  let last = "";
  return (
    <nav className="sidenav no-print" aria-label={label}>
      {items.map((it) => {
        const active = it.href === items[0].href ? path === it.href : path === it.href || path.startsWith(it.href + "/");
        const head = it.group && it.group !== last ? <div className="group" key={`g-${it.group}`}>{it.group}</div> : null;
        last = it.group ?? last;
        return (
          <span key={it.href} style={{ display: "contents" }}>
            {head}
            <Link href={it.href} aria-current={active ? "page" : undefined}>{(() => { const I = iconFor(it.href, items[0].href); return <I size={17} aria-hidden="true" />; })()}{it.label}</Link>
          </span>
        );
      })}
    </nav>
  );
}
