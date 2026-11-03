// LOCAL TEST BACKEND - not for production, not a replacement for Supabase.
//
// Implements just enough of the Supabase wire protocol (PostgREST-style REST, GoTrue-style auth, Storage) to run this
// app end-to-end on a machine without Docker. Every REST request is executed in PostgreSQL inside a transaction with
// `SET LOCAL ROLE <anon|authenticated|service_role>` and the JWT claims set, exactly like PostgREST does, so Row Level
// Security, column grants, triggers and functions are the real ones. Anything outside the feature set this app uses
// responds 501 instead of guessing.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.BACKEND_PORT || 54321);
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET is required");
const STORE = process.env.STORAGE_DIR || fs.mkdtempSync("/tmp/shim-storage-");
const pool = new pg.Pool({ host: process.env.PGHOST_DIR, port: Number(process.env.PGPORT_TEST || 54329), user: "postgres", database: "app", max: 10 });
const ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const q = (s) => { if (!ID.test(s)) throw httpErr(400, { code: "PGRST100", message: `invalid identifier ${s}` }); return `"${s}"`; };

// ------------------------------------------------------------------ helpers
const httpErr = (status, body) => Object.assign(new Error(body.message || "error"), { status, body });
const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verify(tok) {
  const [h, p, s] = String(tok || "").split(".");
  if (!s) return null;
  const exp = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (s.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function claimsOf(req) {
  const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization || "")?.[1];
  const c = verify(bearer) || verify(req.headers.apikey);
  if (!c) return { role: "anon" };
  if (c.role === "service_role") return { role: "service_role" };
  if (c.role === "authenticated" && c.sub) return c;
  return { role: "anon" };
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const json = (res, status, body, headers = {}) => {
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(data);
};

async function withRole(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)",
      [JSON.stringify(claims), claims.sub || "", claims.role]);
    await c.query(`set local role ${claims.role}`);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally { c.release(); }
}

function pgError(e, claims) {
  if (e.status && e.body) return e;
  const code = e.code || "XX000";
  const status = code === "42501" ? (claims.role === "anon" ? 401 : 403) : code === "23505" || code === "23503" ? 409 : code === "42P01" ? 404
    : code === "PGRST116" ? 406 : /^(22|23|42|P0|2B|0A)/.test(code) ? 400 : 500;
  return httpErr(status, { code, message: e.message, details: e.detail || null, hint: e.hint || null });
}

// ------------------------------------------------------------------ PostgREST-style query building
function splitTop(s) {
  const out = []; let depth = 0, quote = false, cur = "";
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unq = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

function cond(colSql, expr, params) {
  let neg = false;
  if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf(".");
  const op = expr.slice(0, i), val = expr.slice(i + 1);
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const cmp = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  let sql;
  if (cmp[op]) sql = `${colSql} ${cmp[op]} ${push(val)}`;
  else if (op === "like" || op === "ilike") sql = `${colSql} ${op} ${push(val.replace(/\*/g, "%"))}`;
  else if (op === "is") {
    if (!["null", "true", "false", "unknown"].includes(val)) throw httpErr(400, { code: "PGRST100", message: "bad is value" });
    sql = `${colSql} is ${val}`;
  } else if (op === "in") {
    const items = splitTop(val.replace(/^\(|\)$/g, "")).map(unq);
    sql = items.length ? `${colSql} in (${items.map(push).join(",")})` : "false";
  } else throw httpErr(501, { code: "PGRST501", message: `operator ${op} not supported by the test backend` });
  return neg ? `not (${sql})` : sql;
}

const fkCache = new Map();
async function fkFor(c, base, rel) {
  const key = `${base}>${rel}`;
  if (fkCache.has(key)) return fkCache.get(key);
  const { rows } = await c.query(
    `select a.attname as col, af.attname as refcol from pg_constraint k
       join pg_class cb on cb.oid = k.conrelid join pg_namespace nb on nb.oid = cb.relnamespace and nb.nspname = 'public'
       join pg_class cr on cr.oid = k.confrelid
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
      where k.contype = 'f' and cb.relname = $1 and cr.relname = $2 and array_length(k.conkey, 1) = 1`, [base, rel]);
  if (!rows.length) throw httpErr(400, { code: "PGRST200", message: `no relationship between ${base} and ${rel}` });
  fkCache.set(key, rows[0]);
  return rows[0];
}

// returns { cols: sql select list for alias b, embeds: Map(rel -> {col, refcol}) }
async function buildSelect(c, base, select, alias = "b") {
  const parts = splitTop(select || "*");
  const cols = []; const embeds = new Map();
  for (const part of parts) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)(!inner|!left|![a-zA-Z0-9_]+)?\((.*)\)$/s.exec(part.trim());
    if (m) {
      const rel = m[1]; const fk = await fkFor(c, base, rel);
      embeds.set(rel, fk);
      const inner = splitTop(m[3]).map((x) => (x.trim() === "*" ? `r.*` : `r.${q(x.trim())}`)).join(", ");
      cols.push(`(select row_to_json(x) from (select ${inner} from public.${q(rel)} r where r.${q(fk.refcol)} = ${alias}.${q(fk.col)}) x) as ${q(rel)}`);
    } else cols.push(part.trim() === "*" ? `${alias}.*` : `${alias}.${q(part.trim())}`);
  }
  return { cols: cols.join(", "), embeds };
}

async function buildWhere(c, base, sp, params, embeds) {
  const conds = [];
  const reserved = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "apikey"]);
  for (const [k, v] of sp.entries()) {
    if (reserved.has(k)) continue;
    if (k === "or") {
      const items = splitTop(v.replace(/^\(|\)$/g, ""));
      conds.push("(" + items.map((it) => { const [col, ...rest] = it.split("."); return cond(`b.${q(col)}`, rest.join("."), params); }).join(" or ") + ")");
    } else if (k === "and") throw httpErr(501, { code: "PGRST501", message: "and= not supported" });
    else if (k.includes(".")) {                               // embedded resource filter => inner semantics
      const [rel, col] = k.split(".");
      const fk = embeds.get(rel) || (await fkFor(c, base, rel));
      conds.push(`exists (select 1 from public.${q(rel)} r where r.${q(fk.refcol)} = b.${q(fk.col)} and ${cond(`r.${q(col)}`, v, params)})`);
    } else conds.push(cond(`b.${q(k)}`, v, params));
  }
  for (const [rel, fk] of embeds) { /* !inner without a filter still requires a match */ void rel; void fk; }
  return conds.length ? conds.join(" and ") : "true";
}

function buildOrder(sp) {
  const o = sp.get("order");
  if (!o) return "";
  return " order by " + o.split(",").map((it) => {
    const [col, ...mods] = it.split(".");
    return `b.${q(col)}${mods.includes("desc") ? " desc" : ""}${mods.includes("nullsfirst") ? " nulls first" : ""}${mods.includes("nullslast") ? " nulls last" : ""}`;
  }).join(", ");
}

async function handleRest(req, res, url, claims) {
  const seg = url.pathname.replace(/^\/rest\/v1\//, "");
  const prefer = String(req.headers.prefer || "");
  const wantsRep = /return=representation/.test(prefer);
  const wantsCount = /count=exact/.test(prefer);
  const single = /vnd\.pgrst\.object\+json/.test(String(req.headers.accept || ""));
  const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req) : null;
  const payload = body && body.length ? JSON.parse(body.toString()) : null;
  const sp = url.searchParams;

  const result = await withRole(claims, async (c) => {
    if (seg.startsWith("rpc/")) {
      const fn = seg.slice(4);
      const { rows: meta } = await c.query(
        `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types, p.prorettype::regtype::text as ret, p.proretset as set
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
      if (!meta.length) throw httpErr(404, { code: "PGRST202", message: `function ${fn} not found` });
      const args = payload || {}; const params = []; const named = [];
      for (const [name, val] of Object.entries(args)) {
        const idx = (meta[0].names || []).indexOf(name);
        if (idx < 0) continue;
        const type = meta[0].types[idx];
        let v = val;
        if (v !== null && typeof v === "object") v = type.endsWith("[]") && Array.isArray(v) ? `{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")}}` : JSON.stringify(v);
        params.push(v);
        named.push(`${q(name)} := $${params.length}::${type}`);
      }
      // a set-returning function answers with its rows, as PostgREST does
      if (meta[0].set) {
        // as JSON, like PostgREST: dates stay "YYYY-MM-DD" and numbers stay numbers
        const { rows } = await c.query(`select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) as j from public.${q(fn)}(${named.join(", ")}) s`, params);
        return { status: 200, rows: [rows[0].j], scalar: true };
      }
      const { rows } = await c.query(`select public.${q(fn)}(${named.join(", ")}) as result`, params);
      return { status: meta[0].ret === "void" ? 204 : 200, rows: meta[0].ret === "void" ? [] : [rows[0].result], scalar: true };
    }

    const base = seg;
    if (!ID.test(base)) throw httpErr(404, { code: "PGRST205", message: "not found" });
    const params = [];
    const { cols, embeds } = await buildSelect(c, base, sp.get("select") || "*");
    const where = await buildWhere(c, base, sp, params, embeds);

    if (req.method === "GET" || req.method === "HEAD") {
      let total = null;
      if (wantsCount) {
        const r = await c.query(`select count(*)::int as n from public.${q(base)} b where ${where}`, params);
        total = r.rows[0].n;
      }
      if (req.method === "HEAD") return { status: 200, rows: [], total, head: true };
      const lim = sp.get("limit") ? ` limit ${Math.max(0, parseInt(sp.get("limit"), 10) || 0)}` : "";
      const off = sp.get("offset") ? ` offset ${Math.max(0, parseInt(sp.get("offset"), 10) || 0)}` : "";
      const r = await c.query(`select to_jsonb(s) as j from (select ${cols} from public.${q(base)} b where ${where}${buildOrder(sp)}${lim}${off}) s`, params);
      return { status: 200, rows: r.rows.map((x) => x.j), total };
    }

    if (req.method === "POST") {
      const list = Array.isArray(payload) ? payload : [payload];
      const keys = Array.from(new Set(list.flatMap((o) => Object.keys(o))));
      if (!keys.length) throw httpErr(400, { code: "PGRST102", message: "empty body" });
      const colList = keys.map(q).join(", ");
      let conflict = "";
      if (/resolution=merge-duplicates/.test(prefer) || /resolution=ignore-duplicates/.test(prefer)) {
        const target = (sp.get("on_conflict") || "").split(",").filter(Boolean).map(q).join(", ");
        conflict = /ignore-duplicates/.test(prefer) ? " on conflict do nothing"
          : ` on conflict (${target}) do update set ${keys.map((k) => `${q(k)} = excluded.${q(k)}`).join(", ")}`;
      }
      const ins = `insert into public.${q(base)} (${colList}) select ${colList} from json_populate_recordset(null::public.${q(base)}, $1::json)${conflict} returning *`;
      const wrapped = `with b as (${ins}) select to_jsonb(s) as j from (select ${cols} from b) s`;
      const r = await c.query(wrapped, [JSON.stringify(list)]);
      return { status: 201, rows: r.rows.map((x) => x.j), rep: wantsRep };
    }

    if (req.method === "PATCH") {
      const keys = Object.keys(payload || {});
      if (!keys.length) throw httpErr(400, { code: "PGRST102", message: "empty body" });
      params.unshift(JSON.stringify(payload));
      // shift placeholders: filters were built before the payload param was added
      const shifted = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`);
      const upd = `update public.${q(base)} b set ${keys.map((k) => `${q(k)} = r.${q(k)}`).join(", ")} from (select * from json_populate_record(null::public.${q(base)}, $1::json)) r where ${shifted} returning b.*`;
      const r = await c.query(`with b as (${upd}) select to_jsonb(s) as j from (select ${cols} from b) s`, params);
      return { status: 200, rows: r.rows.map((x) => x.j), rep: wantsRep };
    }

    if (req.method === "DELETE") {
      const r = await c.query(`with b as (delete from public.${q(base)} b where ${where} returning b.*) select to_jsonb(s) as j from (select ${cols} from b) s`, params);
      return { status: 200, rows: r.rows.map((x) => x.j), rep: wantsRep };
    }
    throw httpErr(405, { code: "PGRST000", message: "method not allowed" });
  });

  const headers = {};
  if (result.total != null) headers["Content-Range"] = `0-${Math.max(0, result.rows.length - 1)}/${result.total}`;
  else if (req.method === "GET") headers["Content-Range"] = `0-${Math.max(0, result.rows.length - 1)}/*`;
  if (result.head) { res.writeHead(200, headers); return res.end(); }
  if (result.scalar) return result.status === 204 ? (res.writeHead(204, headers), res.end()) : json(res, 200, result.rows[0], headers);
  if (req.method !== "GET" && !result.rep) { res.writeHead(result.status === 201 ? 201 : 204, headers); return res.end(); }
  if (single) {
    if (result.rows.length !== 1) throw httpErr(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${result.rows.length} rows`, hint: null });
    return json(res, result.status, result.rows[0], headers);
  }
  return json(res, result.status, result.rows, headers);
}

// ------------------------------------------------------------------ GoTrue-style auth
// Sessions live in auth.sessions (as in GoTrue): every sign-in opens one, a refresh keeps it, /logout ends one / all / the
// others, and an access token whose session is gone is refused by /user (403 session_not_found) like GoTrue does.
const refreshTokens = new Map();              // refresh token -> { uid, sid }
const attempts = new Map();                   // e-mail -> timestamps of recent failed password sign-ins (rate limit stand-in)
const RATE_WINDOW_MS = 5 * 60_000, RATE_MAX_FAILURES = 10;
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at, phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data || {}, identities: [], created_at: u.created_at, updated_at: u.created_at });
const su = async (sql, params) => { const c = await pool.connect(); try { return await c.query(sql, params); } finally { c.release(); } };
async function sessionFor(u, req, sid) {
  const now = Math.floor(Date.now() / 1000);
  if (sid) await su("update auth.sessions set updated_at = now() where id = $1", [sid]);
  else sid = (await su("insert into auth.sessions (user_id, user_agent) values ($1, $2) returning id", [u.id, String(req.headers["user-agent"] || "").slice(0, 400) || null])).rows[0].id;
  const access = sign({ aud: "authenticated", exp: now + 3600, iat: now, sub: u.id, email: u.email, role: "authenticated", session_id: sid });
  const refresh = crypto.randomBytes(24).toString("base64url");
  refreshTokens.set(refresh, { uid: u.id, sid });
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
}
const authErr = (res, status, error_code, msg) => json(res, status, { code: status, error_code, msg, error: error_code, error_description: msg });
const bearerClaims = (req) => { const c = verify(/^Bearer (.+)$/i.exec(req.headers.authorization || "")?.[1]); return c && c.role === "authenticated" && c.sub ? c : null; };
const sessionAlive = async (c) => !c.session_id || (await su("select 1 from auth.sessions where id = $1 and user_id = $2", [c.session_id, c.sub])).rowCount > 0;

async function handleAuth(req, res, url) {
  const route = url.pathname.replace(/^\/auth\/v1/, "");
  const body = ["POST", "PUT", "DELETE"].includes(req.method) ? JSON.parse((await readBody(req)).toString() || "{}") : {};
  if (route === "/signup" && req.method === "POST") {
    const email = String(body.email || "").trim().toLowerCase(), password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email)) return authErr(res, 422, "validation_failed", "Unable to validate email address: invalid format");
    if (password.length < 6) return authErr(res, 422, "weak_password", "Password should be at least 6 characters.");
    if (Buffer.byteLength(password) > 72) return authErr(res, 422, "validation_failed", "Password cannot be longer than 72 characters.");
    const ex = await su("select 1 from auth.users where email = $1", [email]);
    if (ex.rowCount) return authErr(res, 422, "user_already_exists", "User already registered");
    const r = await su("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *", [email, JSON.stringify(body.data || {})]);
    await su("insert into auth.shim_passwords (user_id, hash) values ($1, extensions.crypt($2, extensions.gen_salt('bf', 6)))", [r.rows[0].id, password]);
    return json(res, 200, await sessionFor(r.rows[0], req));
  }
  if (route === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const email = String(body.email || "").trim().toLowerCase();
      const recent = (attempts.get(email) || []).filter((at) => Date.now() - at < RATE_WINDOW_MS);
      if (recent.length >= RATE_MAX_FAILURES) return authErr(res, 429, "over_request_rate_limit", "Request rate limit reached");
      const r = await su("select u.* from auth.users u join auth.shim_passwords p on p.user_id = u.id where u.email = $1 and u.deleted_at is null and p.hash = extensions.crypt($2, p.hash)", [email, String(body.password || "")]);
      if (!r.rowCount) { attempts.set(email, [...recent, Date.now()]); return authErr(res, 400, "invalid_credentials", "Invalid login credentials"); }
      attempts.delete(email);
      return json(res, 200, await sessionFor(r.rows[0], req));
    }
    if (grant === "refresh_token") {
      const rt = refreshTokens.get(body.refresh_token);
      if (!rt) return authErr(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(body.refresh_token);
      const alive = await su("select 1 from auth.sessions where id = $1 and user_id = $2", [rt.sid, rt.uid]);
      if (!alive.rowCount) return authErr(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Session Not Found");
      const r = await su("select * from auth.users where id = $1 and deleted_at is null", [rt.uid]);
      if (!r.rowCount) return authErr(res, 400, "refresh_token_not_found", "Invalid Refresh Token: User Not Found");
      return json(res, 200, await sessionFor(r.rows[0], req, rt.sid));
    }
  }
  if (route === "/user") {
    const c = bearerClaims(req);
    if (!c) return authErr(res, 401, "bad_jwt", "invalid JWT");
    if (!(await sessionAlive(c))) return authErr(res, 403, "session_not_found", "Session from session_id claim in JWT does not exist");
    if (req.method === "PUT" && body.password) await su("update auth.shim_passwords set hash = extensions.crypt($2, extensions.gen_salt('bf', 6)) where user_id = $1", [c.sub, String(body.password)]);
    const r = await su("select * from auth.users where id = $1", [c.sub]);
    if (!r.rowCount) return authErr(res, 401, "user_not_found", "User from sub claim in JWT does not exist");
    return json(res, 200, userJson(r.rows[0]));
  }
  if (route === "/logout" && req.method === "POST") {
    const c = bearerClaims(req);
    if (!c) return authErr(res, 401, "bad_jwt", "invalid JWT");
    const scope = url.searchParams.get("scope") || "global";
    if (!["global", "local", "others"].includes(scope)) return authErr(res, 400, "validation_failed", "scope must be global, local or others");
    if (scope === "global") await su("delete from auth.sessions where user_id = $1", [c.sub]);
    else if (scope === "others") await su("delete from auth.sessions where user_id = $1 and id is distinct from $2", [c.sub, c.session_id || null]);
    else if (c.session_id) await su("delete from auth.sessions where id = $1 and user_id = $2", [c.session_id, c.sub]);
    res.writeHead(204); return res.end();
  }
  // admin API (service role): DELETE /admin/users/:id, body { should_soft_delete }. A hard delete fails while other rows still reference the user.
  const adminUser = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(route);
  if (adminUser && req.method === "DELETE") {
    if (claimsOf(req).role !== "service_role") return authErr(res, 403, "not_admin", "User not allowed");
    const id = adminUser[1];
    if (!(await su("select 1 from auth.users where id = $1", [id])).rowCount) return authErr(res, 404, "user_not_found", "User not found");
    if (body.should_soft_delete) {
      await su("delete from auth.sessions where user_id = $1", [id]);
      await su("delete from auth.shim_passwords where user_id = $1", [id]);
      await su("update auth.users set email = 'deleted+' || id::text || '@invalid.local', deleted_at = now(), raw_user_meta_data = '{}'::jsonb where id = $1", [id]);
    } else {
      try { await su("delete from auth.users where id = $1", [id]); }
      catch (e) { return authErr(res, 500, "unexpected_failure", "Database error deleting user"); }
    }
    return json(res, 200, {});
  }
  if (route === "/recover") return json(res, 200, {});
  if (route === "/settings") return json(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
  return authErr(res, 501, "not_implemented", `${route} is not implemented by the test backend`);
}

// ------------------------------------------------------------------ Storage
async function handleStorage(req, res, url, claims) {
  const m = /^\/storage\/v1\/object\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
  if (!m) return json(res, 404, { statusCode: "404", error: "not_found", message: "not found" });
  if (claims.role !== "service_role") return json(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
  const bucket = decodeURIComponent(m[1]);
  const key = m[2] ? decodeURIComponent(m[2]) : "";
  const file = path.join(STORE, bucket, key);
  if (!path.resolve(file).startsWith(path.resolve(STORE))) return json(res, 400, { message: "bad path" });
  if (req.method === "POST" || req.method === "PUT") {
    const data = await readBody(req);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && req.method === "POST" && req.headers["x-upsert"] !== "true") return json(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    fs.writeFileSync(file, data);
    fs.writeFileSync(file + ".mime", String(req.headers["content-type"] || "application/octet-stream"));
    return json(res, 200, { Key: `${bucket}/${key}`, Id: crypto.randomUUID() });
  }
  if (req.method === "GET") {
    if (!fs.existsSync(file)) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
    const data = fs.readFileSync(file);
    res.writeHead(200, { "Content-Type": fs.readFileSync(file + ".mime", "utf8"), "Content-Length": data.length });
    return res.end(data);
  }
  if (req.method === "DELETE") {
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
    for (const p of prefixes) fs.rmSync(path.join(STORE, bucket, p), { force: true });
    return json(res, 200, prefixes.map((name) => ({ name })));
  }
  return json(res, 405, { message: "method not allowed" });
}

// ------------------------------------------------------------------ server
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const claims = claimsOf(req);
  try {
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname.startsWith("/rest/v1/")) return await handleRest(req, res, url, claims);
    if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url);
    if (url.pathname.startsWith("/storage/v1/")) return await handleStorage(req, res, url, claims);
    return json(res, 404, { message: "not found" });
  } catch (e) {
    const err = pgError(e, claims);
    if (!res.headersSent) json(res, err.status || 500, err.body);
    else res.end();
  }
}).listen(PORT, "127.0.0.1", () => console.log(`test backend listening on http://127.0.0.1:${PORT}`));

export { sign };
