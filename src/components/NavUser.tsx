"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Languages, LogOut, Moon, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { setLang, setTheme } from "@/app/actions/prefs";

export interface NavUserText {
  patients: string; account: string; admin: string; signOut: string; menu: string;
  langLabel: string; nextLang: "ar" | "en"; themeLabel: string; nextTheme: "light" | "dark"; dark: boolean;
}

const initials = (n: string) => Array.from(n.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? "").join("") || "?").join("").toUpperCase();

/** Account menu in the top bar: profile header, shortcuts, language / theme, sign out. Keyboard and screen-reader friendly. */
export function NavUser({ name, email, admin, text }: { name: string; email: string; admin: boolean; text: NavUserText }) {
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

  return (
    <div className="navuser" ref={root} onKeyDown={onKey}>
      <button ref={trigger} type="button" className="navuser-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={`${text.menu}: ${name}`} onClick={() => setOpen((v) => !v)}>
        <span className="avatar sm" aria-hidden="true">{initials(name || email)}</span>
        <span className="navuser-name">{name || email}</span>
        <ChevronDown size={16} aria-hidden="true" className="navuser-chev" />
      </button>
      {open && (
        <div className="menu" id={menuId} role="menu" aria-label={text.menu}>
          <div className="menu-head" role="presentation">
            <span className="avatar" aria-hidden="true">{initials(name || email)}</span>
            <div style={{ minWidth: 0 }}>
              <strong className="menu-name">{name || email}</strong>
              <div className="menu-mail"><span className="ltr">{email}</span></div>
            </div>
          </div>
          <Link role="menuitem" href="/patients" className="menu-item" tabIndex={-1}><Users size={17} aria-hidden="true" />{text.patients}</Link>
          <Link role="menuitem" href="/account" className="menu-item" tabIndex={-1}><Settings size={17} aria-hidden="true" />{text.account}</Link>
          {admin && <Link role="menuitem" href="/admin/specialties" className="menu-item" tabIndex={-1}><ShieldCheck size={17} aria-hidden="true" />{text.admin}</Link>}
          <div className="menu-sep" role="separator" />
          <form action={setLang} role="none">
            <input type="hidden" name="lang" value={text.nextLang} />
            <button role="menuitem" className="menu-item" tabIndex={-1}><Languages size={17} aria-hidden="true" />{text.langLabel}</button>
          </form>
          <form action={setTheme} role="none">
            <input type="hidden" name="theme" value={text.nextTheme} />
            <button role="menuitem" className="menu-item" tabIndex={-1}>{text.dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}{text.themeLabel}</button>
          </form>
          <div className="menu-sep" role="separator" />
          <form action={logout} role="none">
            <button role="menuitem" className="menu-item danger" tabIndex={-1}><LogOut size={17} aria-hidden="true" />{text.signOut}</button>
          </form>
        </div>
      )}
    </div>
  );
}
