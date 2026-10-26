import "server-only";
import { createHash, createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";

/** Client origin hash (salted HMAC of the IP). The raw address is never stored. */
export function clientMeta(): { ipHash: string; ua: string } {
  const h = headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  const salt = process.env.SHARE_HASH_SALT;
  if (!salt && process.env.NODE_ENV === "production") throw new Error("SHARE_HASH_SALT must be set in production");
  return { ipHash: createHmac("sha256", salt || "dev-only-salt").update(ip).digest("hex").slice(0, 32), ua: (h.get("user-agent") ?? "").slice(0, 300) };
}

const cookieName = (token: string) => `shs_${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;

export function getShareSession(token: string): string | null {
  return cookies().get(cookieName(token))?.value ?? null;
}

export function setShareSession(token: string, session: string, maxAgeSeconds: number) {
  cookies().set(cookieName(token), session, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/s", maxAge: Math.max(60, maxAgeSeconds),
  });
}

export function clearShareSession(token: string) {
  cookies().delete({ name: cookieName(token), path: "/s" });
}

export const validToken = (t: string) => /^[A-Za-z0-9_-]{20,128}$/.test(t);
