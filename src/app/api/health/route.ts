import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isConfigured, publicEnv, siteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const time = async (fn: () => Promise<unknown>) => {
  const t0 = Date.now();
  try { await fn(); return { ms: Date.now() - t0 }; } catch (e) { return { ms: Date.now() - t0, error: String((e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.message).slice(0, 80) }; }
};

/** GET /api/health            -> {ok:true}
 *  GET /api/health?probe=1    -> latency probes (no data, no secrets): database round trips and a request to this
 *                                server's own public address (what Next does after a server-action redirect).
 *                                Operators only: `Authorization: Bearer $CRON_SECRET`; the address comes from the
 *                                configuration, never from the request. */
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("probe") !== "1") return NextResponse.json({ ok: true });
  const secret = process.env.CRON_SECRET;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || secret.length < 24 || !same(given, secret)) return NextResponse.json({ ok: true });
  const out: Record<string, unknown> = { ok: true, node: process.version, configured: isConfigured() };
  if (isConfigured()) {
    const { url, key } = publicEnv();
    const h = { apikey: key };
    out.supabase_auth = await Promise.all([1, 2, 3].map(() => time(() => fetch(`${url}/auth/v1/health`, { headers: h }))));
    const seq: unknown[] = [];
    for (let i = 0; i < 3; i++) seq.push(await time(() => fetch(`${url}/rest/v1/medical_specialties?select=id&limit=1`, { headers: { ...h, Authorization: `Bearer ${key}` } })));
    out.supabase_rest_sequential = seq;
  }
  if (request.nextUrl.searchParams.get("geo") === "1") {
    // where does this server run? (public IP geolocation of the server itself; no user data involved)
    try { const g = await (await fetch("https://ipinfo.io/json", { cache: "no-store", signal: AbortSignal.timeout(6000) })).json(); out.server_location = { city: g.city, region: g.region, country: g.country, org: g.org }; }
    catch (e) { out.server_location = { error: String((e as Error)?.message) }; }
  }
  const site = siteUrl();
  out.self_public = { site, ...(await time(() => fetch(`${site}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(15000) }))) };
  out.self_loopback = { port: process.env.PORT ?? null, ...(await time(() => fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) }))) };
  return NextResponse.json(out);
}
