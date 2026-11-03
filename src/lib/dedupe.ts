/** Helpers for spotting a record that is probably entered twice. They warn; the user can still save. */

/** Folds case, spacing, Arabic diacritics and letter variants so "السكري " and "السُّكَّري" compare equal. */
export function normText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")          // harakat, superscript alef, tatweel
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[\s‌‏‎]+/g, " ")
    .replace(/[()\[\]{}"'«».,،؛;:!?؟\-–—/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same calendar instant to the minute. */
export function sameMinute(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return Math.abs(Date.parse(a) - Date.parse(b)) < 60_000;
}

/** Within `hours` of each other (lab results transcribed from the same sheet rarely carry the exact same time). */
export function within(a: string | null | undefined, b: string | null | undefined, hours: number): boolean {
  if (!a || !b) return false;
  return Math.abs(Date.parse(a) - Date.parse(b)) <= hours * 3_600_000;
}

/** Numbers equal to 6 significant digits (0.1 + 0.2 === 0.3). */
export function sameNumber(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  if (a == null || b == null || a === "" || b === "") return a == null && b == null;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
}
