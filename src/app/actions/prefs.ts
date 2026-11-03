"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const YEAR = 60 * 60 * 24 * 365;

export async function setLang(fd: FormData) {
  const v = fd.get("lang") === "en" ? "en" : "ar";
  cookies().set("lang", v, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function setTheme(fd: FormData) {
  const v = fd.get("theme");
  if (v === "light" || v === "dark") cookies().set("theme", v, { path: "/", maxAge: YEAR, sameSite: "lax" });
  else cookies().delete("theme");
  revalidatePath("/", "layout");
}
