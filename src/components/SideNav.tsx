"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
            <Link href={it.href} aria-current={active ? "page" : undefined}>{it.label}</Link>
          </span>
        );
      })}
    </nav>
  );
}
