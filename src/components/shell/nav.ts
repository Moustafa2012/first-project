/**
 * The navigation model of the app shell (Supabase-style): a rail of products, and for the active product a menu of
 * its pages. Built on the server (it knows the patient, the specialties in use, the counts), rendered by client
 * components that know the current path.
 */
export interface ShellItem { href: string; label: string; icon?: string; specialtyIcon?: string; exact?: boolean; tab?: string; defaultTab?: boolean; badge?: string }
/** `onlyOn`: the group shows only on pages under this path (e.g. a specialty's own sections inside that specialty) */
export interface ShellGroup { label?: string; items: ShellItem[]; onlyOn?: string }
export interface ShellProduct {
  key: string; label: string; icon: string; href: string;
  /** paths that make this product active (prefix match; "=" prefix means exact) */
  match: string[];
  menu?: { title: string; groups: ShellGroup[] };
}
export interface ShellNav { products: ShellProduct[]; footer: ShellProduct[]; home?: { href: string; label: string } }
export interface Crumb { href?: string; label: string }

const matches = (path: string, m: string) => (m.startsWith("=") ? path === m.slice(1) : path === m || path.startsWith(m + "/"));

/** The active product: the longest matching path wins. */
export function activeProduct(nav: ShellNav, path: string): ShellProduct | undefined {
  let best: { p: ShellProduct; len: number } | undefined;
  for (const p of [...nav.products, ...nav.footer]) for (const m of p.match) {
    if (matches(path, m) && (!best || m.length > best.len)) best = { p, len: m.length };
  }
  return best?.p;
}

/** Is this menu item the current page (path, and the ?tab= when the item has one)? */
export function itemActive(it: ShellItem, path: string, tab: string | null): boolean {
  const base = it.href.split("?")[0];
  if (it.tab !== undefined) return path === base && (tab === it.tab || (!tab && Boolean(it.defaultTab)));
  return it.exact ? path === base : path === base || path.startsWith(base + "/");
}

export const groupVisible = (g: ShellGroup, path: string) => !g.onlyOn || path === g.onlyOn || path.startsWith(g.onlyOn + "/");
