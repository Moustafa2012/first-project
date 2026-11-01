#!/usr/bin/env bash
WORK="${WORK:-/tmp/shifa-dev-backend}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
[ -f "$WORK/backend.pid" ] && kill "$(cat "$WORK/backend.pid")" 2>/dev/null
[ -f "$WORK/next.pid" ] && kill -- "-$(cat "$WORK/next.pid")" 2>/dev/null
if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1; else "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1; fi
rm -rf "$WORK"
