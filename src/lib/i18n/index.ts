import { cookies } from "next/headers";

export type Lang = "ar" | "en";

export function getLang(): Lang {
  return cookies().get("lang")?.value === "en" ? "en" : "ar";
}

/** Server-side translator: t("عربي", "English"). Strings live next to the markup that uses them. */
export function i18n() {
  const lang = getLang();
  return {
    lang,
    dir: lang === "ar" ? ("rtl" as const) : ("ltr" as const),
    t: (ar: string, en: string) => (lang === "ar" ? ar : en),
    pick: (o: { ar: string; en: string }) => o[lang],
  };
}

export type T = ReturnType<typeof i18n>["t"];
