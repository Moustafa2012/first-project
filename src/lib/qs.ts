/** Builds a query string from the current params with overrides (undefined/empty removes a key). */
export function qs(current: Record<string, string | string[] | undefined>, over: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  const merged: Record<string, string | string[] | undefined> = { ...current, ...over };
  for (const [k, v] of Object.entries(merged)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) p.set(k, val);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
