#!/usr/bin/env bash
# Runs every migration, then every supabase/tests/*.test.sql, on a throwaway PostgreSQL 16 cluster.
# Requires the PostgreSQL 16 server binaries; if run as root it drops to the "postgres" user.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-54329}"
WORK="$(mktemp -d)"
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
  RUN=(runuser -u postgres --)
  chmod -R a+rX "$ROOT/supabase"
else
  RUN=()
fi
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "create database app" >/dev/null
"${PSQL[@]}" -d app -f "$ROOT/supabase/tests/bootstrap.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migration: $(basename "$f")"
  "${PSQL[@]}" -d app -f "$f" >/dev/null
done
status=0
for f in "$ROOT"/supabase/tests/*.test.sql; do
  [ -e "$f" ] || continue
  echo "test: $(basename "$f")"
  out="$("${PSQL[@]}" -d app -f "$f" 2>&1)" && rc=0 || rc=$?
  out="$(printf "%s\n" "$out" | grep -v "^[[:space:]]*$" || true)"
  [ -n "$out" ] && echo "$out"
  [ "$rc" -ne 0 ] && status=1
done
exit $status
