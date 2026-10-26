import type { Lang } from "@/lib/i18n";

// Latin digits and Gregorian calendar in both languages: medical values must read unambiguously.
const loc = (lang: Lang) => (lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB");

export function fmtDate(v: string | Date | null | undefined, lang: Lang, tz = "UTC"): string {
  if (!v) return "";
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00Z") : new Date(v);
  if (Number.isNaN(+d)) return "";
  const dateOnly = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return new Intl.DateTimeFormat(loc(lang), { year: "numeric", month: "short", day: "numeric", timeZone: dateOnly ? "UTC" : tz }).format(d);
}

export function fmtDateTime(v: string | Date | null | undefined, lang: Lang, tz = "UTC"): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(+d)) return "";
  return new Intl.DateTimeFormat(loc(lang), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
}

export function safeTz(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Age is always computed from the date of birth, never stored. */
export function ageParts(dob: string, now: Date = new Date()): { years: number; months: number } {
  const [y, m, d] = dob.split("-").map(Number);
  let years = now.getUTCFullYear() - y;
  let months = now.getUTCMonth() + 1 - m;
  if (now.getUTCDate() < d) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  return { years: Math.max(0, years), months: Math.max(0, months) };
}

export function ageLabel(dob: string, lang: Lang, now: Date = new Date()): string {
  const { years, months } = ageParts(dob, now);
  if (years >= 2) return lang === "ar" ? `${years} سنة` : `${years} y`;
  const total = years * 12 + months;
  return lang === "ar" ? `${total} شهراً` : `${total} mo`;
}

export function fmtNum(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(n)) return "";
  return Number(n.toFixed(decimals)).toString();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
