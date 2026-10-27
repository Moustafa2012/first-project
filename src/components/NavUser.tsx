/* eslint-disable @next/next/no-img-element -- avatars are small private images served by /api/avatar */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Languages, Link2, LogOut, Moon, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { setLang, setTheme } from "@/app/actions/prefs";

export interface NavUserText {
  patients: string; shares: string; account: string; admin: string; signOut: string; menu: string;
  sectionAccount: string; sectionPrefs: string; roleLabel: string; langCode: string; langLabel: string; nextLang: "ar" | "en"; themeLabel: string; nextTheme: "light" | "dark"; dark: boolean;
}

const initials = (n: string) => Array.from(n.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? "").join("") || "?").join("").toUpperCase();

/** Account menu in the top bar: profile header, shortcuts, language / theme, sign out. Keyboard and screen-reader friendly. */
export function NavUser({ name, email, admin, text, avatar }: { name: string; email: string; admin: boolean; text: NavUserText; avatar?: string | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const menuId = useId();

  const items = useCallback(() => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []), []);
  const close = useCallback((refocus = false) => { setOpen(false); if (refocus) trigger.current?.focus(); }, []);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("touchstart", onDown);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); };
  }, [open]);
  useEffect(() => { if (open) items()[0]?.focus(); }, [open, items]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    if (!open) return;
    const list = items(); const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };

  const face = (cls: string) => <span className={`avatar ${cls}`} aria-hidden="true">{avatar ? <img src={avatar} alt="" className="avatar-img" /> : initials(name || email)}</span>;
  return (
    <div className="navuser" ref={root} onKeyDown={onKey}>
      <button ref={trigger} type="button" className="navuser-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={`${text.menu}: ${name}`} onClick={() => setOpen((v) => !v)}>
        {face("sm")}
        <span className="navuser-id">
          <span className="navuser-name">{name || email}</span>
          <span className="navuser-sub">{text.roleLabel}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className="navuser-chev" />
      </button>
      {open && <div className="menu-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
      {open && (
        <div className="menu" id={menuId} role="menu" aria-label={text.menu}>
          <div className="menu-grab" aria-hidden="true" />
          <div className="menu-head" role="presentation">
            {face("lg-ring")}
            <div style={{ minWidth: 0 }}>
              <strong className="menu-name">{name || email}</strong>
              <div className="menu-mail"><span className="ltr">{email}</span></div>
              <span className="chip info menu-role">{admin ? <ShieldCheck size={12} aria-hidden="true" /> : null}{text.roleLabel}</span>
            </div>
          </div>
          <div className="menu-label" role="presentation">{text.sectionAccount}</div>
          <Link role="menuitem" href="/patients" className="menu-item" tabIndex={-1}><span className="mi"><Users size={16} aria-hidden="true" /></span><span className="mt">{text.patients}</span><ChevronRight size={15} aria-hidden="true" className="mgo" /></Link>
          <Link role="menuitem" href="/shares" className="menu-item" tabIndex={-1}><span className="mi"><Link2 size={16} aria-hidden="true" /></span><span className="mt">{text.shares}</span><ChevronRight size={15} aria-hidden="true" className="mgo" /></Link>
          <Link role="menuitem" href="/account" className="menu-item" tabIndex={-1}><span className="mi"><Settings size={16} aria-hidden="true" /></span><span className="mt">{text.account}</span><ChevronRight size={15} aria-hidden="true" className="mgo" /></Link>
          {admin && <Link role="menuitem" href="/admin/specialties" className="menu-item" tabIndex={-1}><span className="mi"><ShieldCheck size={16} aria-hidden="true" /></span><span className="mt">{text.admin}</span><ChevronRight size={15} aria-hidden="true" className="mgo" /></Link>}
          <div className="menu-label" role="presentation">{text.sectionPrefs}</div>
          <form action={setLang} role="none">
            <input type="hidden" name="lang" value={text.nextLang} />
            <button role="menuitem" className="menu-item" tabIndex={-1}><span className="mi"><Languages size={16} aria-hidden="true" /></span><span className="mt">{text.langLabel}</span><span className="chip menu-badge">{text.langCode}</span></button>
          </form>
          <form action={setTheme} role="none">
            <input type="hidden" name="theme" value={text.nextTheme} />
            <button role="menuitem" className="menu-item" tabIndex={-1}><span className="mi">{text.dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</span><span className="mt">{text.themeLabel}</span><span className={`switch${text.dark ? " on" : ""}`} aria-hidden="true" /></button>
          </form>
          <div className="menu-sep" role="separator" />
          <form action={logout} role="none">
            <button role="menuitem" className="menu-item danger" tabIndex={-1}><span className="mi"><LogOut size={16} aria-hidden="true" /></span><span className="mt">{text.signOut}</span></button>
          </form>
        </div>
      )}
    </div>
  );
}
