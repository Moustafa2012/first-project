"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, AlertTriangle, ArrowLeftRight, CalendarDays, ClipboardList, FileText, FlaskConical, FolderHeart, FolderOpen, HeartPulse, History, Home, Layers,
  Link2, Menu, NotebookPen, Pill, ScanLine, Scissors, Settings, Share2, ShieldCheck, Smile, Stethoscope, Syringe, TestTube2, UserRound, Users, X,
  LayoutGrid, Stethoscope as Visit, Image as ImageIcon, ListChecks, Wrench, Trash2, type LucideIcon,
} from "lucide-react";
import { SpecialtyIcon } from "@/components/Icon";
import { activeProduct, groupVisible, itemActive, type ShellItem, type ShellNav as Nav, type ShellProduct } from "./nav";

const ICONS: Record<string, LucideIcon> = {
  home: Home, core: UserRound, timeline: History, follow: Activity, specialties: Layers, records: FolderHeart, docs: FolderOpen,
  patients: Users, shares: Link2, account: Settings, admin: ShieldCheck, switch: ArrowLeftRight,
  vitals: Activity, labs: FlaskConical, "test-orders": TestTube2, "care-plans": ClipboardList, conditions: HeartPulse, allergies: AlertTriangle,
  medications: Pill, visits: Stethoscope, procedures: Scissors, imaging: ScanLine, appointments: CalendarDays, notes: NotebookPen,
  immunizations: Syringe, "family-history": Users, documents: FileText, sharing: Share2, audit: ShieldCheck, dental: Smile, other: LayoutGrid,
  chart: Smile, problems: HeartPulse, treatment: ListChecks, care: Visit, images: ImageIcon, profile: Wrench, delete: Trash2,
};

function ItemIcon({ it, size = 16 }: { it: Pick<ShellItem, "icon" | "specialtyIcon">; size?: number }) {
  if (it.specialtyIcon) return <SpecialtyIcon name={it.specialtyIcon} size={size} />;
  const I = ICONS[it.icon ?? ""] ?? FolderHeart;
  return <I size={size} aria-hidden="true" />;
}

function useNav(nav: Nav) {
  const path = usePathname();
  const tab = useSearchParams().get("tab");
  return { path, tab, active: activeProduct(nav, path) };
}

/** The product rail: icons only, widening on hover or keyboard focus to show the names (it overlays the page, nothing moves). */
export function ShellRail({ nav, label }: { nav: Nav; label: string }) {
  const { active } = useNav(nav);
  const link = (p: ShellProduct) => (
    <Link key={p.key} href={p.href} className="rail-link" aria-current={active?.key === p.key ? "page" : undefined} title={p.label} data-product={p.key}>
      <ItemIcon it={{ icon: p.icon }} size={19} /><span className="rail-label">{p.label}</span>
    </Link>
  );
  return (
    <nav className="rail no-print" aria-label={label}>
      <div className="rail-in">
        {nav.home && (
          <Link href={nav.home.href} className="rail-link rail-home" title={nav.home.label}>
            <ItemIcon it={{ icon: "patients" }} size={19} /><span className="rail-label">{nav.home.label}</span>
          </Link>
        )}
        <div className="rail-items">{nav.products.map(link)}</div>
        <div className="rail-foot">{nav.footer.map(link)}</div>
      </div>
    </nav>
  );
}

function MenuGroups({ product, path, tab, onNavigate }: { product: ShellProduct; path: string; tab: string | null; onNavigate?: () => void }) {
  return (
    <>
      {product.menu!.groups.filter((g) => groupVisible(g, path)).map((g, gi) => (
        <div className="pm-group" key={gi}>
          {g.label && <div className="pm-group-label">{g.label}</div>}
          <ul>
            {g.items.map((it) => (
              <li key={it.href + (it.tab ?? "")}>
                <Link href={it.href} aria-current={itemActive(it, path, tab) ? "page" : undefined} onClick={onNavigate}>
                  <ItemIcon it={it} /><span>{it.label}</span>{it.badge && <span className="pm-badge">{it.badge}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The menu of the active product, next to the rail (desktop); nothing when the product is a single page. */
export function ShellProductMenu({ nav }: { nav: Nav }) {
  const { path, tab, active } = useNav(nav);
  if (!active?.menu) return null;
  return (
    <nav className="product-menu no-print" aria-label={active.menu.title}>
      <div className="pm-title">{active.menu.title}</div>
      <MenuGroups product={active} path={path} tab={tab} />
    </nav>
  );
}

/** Small screens: a horizontal strip of the active product's pages, and a drawer with every product. */
export function ShellMobile({ nav, label, openLabel, closeLabel }: { nav: Nav; label: string; openLabel: string; closeLabel: string }) {
  const { path, tab, active } = useNav(nav);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path, tab]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);
  return (
    <>
      <button type="button" className="btn ghost sm shell-burger no-print" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} aria-label={openLabel}>
        <Menu size={20} aria-hidden="true" />
      </button>
      {/* in a portal: the top bar's backdrop filter would otherwise confine a fixed drawer to the bar */}
      {open && createPortal(
        <div className="drawer-wrap no-print" onClick={() => setOpen(false)}>
          <div className="drawer" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
            <div className="row between drawer-head">
              <strong>{label}</strong>
              <button type="button" className="btn ghost sm" onClick={() => setOpen(false)} aria-label={closeLabel}><X size={18} aria-hidden="true" /></button>
            </div>
            {nav.home && <Link className="drawer-link" href={nav.home.href}><ItemIcon it={{ icon: "patients" }} size={18} />{nav.home.label}</Link>}
            {[...nav.products, ...nav.footer].map((p) => (
              <div key={p.key} className="drawer-product">
                <Link className="drawer-link" href={p.href} aria-current={active?.key === p.key ? "page" : undefined}><ItemIcon it={{ icon: p.icon }} size={18} />{p.label}</Link>
                {active?.key === p.key && p.menu && <div className="drawer-sub"><MenuGroups product={p} path={path} tab={tab} onNavigate={() => setOpen(false)} /></div>}
              </div>
            ))}
          </div>
        </div>, document.body,
      )}
    </>
  );
}

/** The active product's pages as a scrollable strip under the top bar (small screens only). */
export function ShellSubnav({ nav }: { nav: Nav }) {
  const { path, tab, active } = useNav(nav);
  if (!active?.menu) return null;
  const groups = active.menu.groups.filter((g) => groupVisible(g, path));
  // inside a specialty with its own sections, the strip shows those sections
  const own = groups.find((g) => g.onlyOn);
  const items = own ? own.items : groups.flatMap((g) => g.items);
  return (
    <nav className="shell-subnav no-print" aria-label={active.menu.title}>
      {items.map((it) => (
        <Link key={it.href + (it.tab ?? "")} href={it.href} aria-current={itemActive(it, path, tab) ? "page" : undefined}>
          <ItemIcon it={it} size={15} />{it.label}{it.badge ? ` (${it.badge})` : ""}
        </Link>
      ))}
    </nav>
  );
}

/** The end of the path in the top bar: the active product, and the page within it. */
export function ShellCrumbTail({ nav }: { nav: Nav }) {
  const { path, tab, active } = useNav(nav);
  if (!active) return null;
  // the page, and inside a specialty with its own sections also the specialty: Specialty files / Dentistry / Chart & exams
  const hits = (active.menu?.groups ?? []).filter((g) => groupVisible(g, path)).flatMap((g) => g.items).filter((it) => itemActive(it, path, tab) && it.label !== active.label);
  const trail = [...hits.filter((it) => it.tab === undefined).slice(0, 1), ...hits.filter((it) => it.tab !== undefined).slice(0, 1)];
  return (
    <>
      <li>{trail.length ? <Link href={active.href}>{active.label}</Link> : <span aria-current="page">{active.label}</span>}</li>
      {trail.map((it, i) => (
        <li key={it.href}>{i < trail.length - 1 ? <Link href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}</li>
      ))}
    </>
  );
}
