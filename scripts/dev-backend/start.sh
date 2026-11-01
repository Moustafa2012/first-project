#!/usr/bin/env bash
# Starts a throwaway local PostgreSQL 16 (all migrations applied) plus the test backend that speaks the Supabase protocol.
# For local development / automated tests only. Writes connection settings to $WORK/env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-54329}"
API_PORT="${BACKEND_PORT:-54321}"
APP_PORT="${APP_PORT:-3000}"
WORK="${WORK:-/tmp/shifa-dev-backend}"
rm -rf "$WORK"; mkdir -p "$WORK/storage"
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN=(runuser -u postgres --); chmod -R a+rX "$ROOT/supabase"; else RUN=(); fi

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "create database app" >/dev/null
"${PSQL[@]}" -d app -f "$ROOT/supabase/tests/bootstrap.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d app -f "$f" >/dev/null 2>&1; done
"${PSQL[@]}" -d app -c "create table auth.shim_passwords (user_id uuid primary key references auth.users(id) on delete cascade, hash text not null)" >/dev/null

SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
mint() { SECRET="$SECRET" ROLE="$1" node -e '
  const c=require("crypto"),b=(x)=>Buffer.from(x).toString("base64url");
  const h=b(JSON.stringify({alg:"HS256",typ:"JWT"})),p=b(JSON.stringify({role:process.env.ROLE,iss:"shim",iat:1700000000,exp:4102444800}));
  process.stdout.write(h+"."+p+"."+c.createHmac("sha256",process.env.SECRET).update(h+"."+p).digest("base64url"))'; }
cat > "$WORK/env" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$API_PORT
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(mint anon)
SUPABASE_SERVICE_ROLE_KEY=$(mint service_role)
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:$APP_PORT
SHARE_HASH_SALT=local-test-salt
JWT_SECRET=$SECRET
ENV
JWT_SECRET="$SECRET" PGHOST_DIR="$WORK" PGPORT_TEST="$PORT" BACKEND_PORT="$API_PORT" STORAGE_DIR="$WORK/storage" \
  nohup node "$ROOT/scripts/dev-backend/server.mjs" > "$WORK/backend.log" 2>&1 &
echo $! > "$WORK/backend.pid"
for i in $(seq 1 40); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { echo "backend failed to start"; cat "$WORK/backend.log"; exit 1; }
echo "ready: $WORK/env"
