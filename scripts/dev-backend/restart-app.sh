#!/usr/bin/env bash
# Rebuilds and (re)starts the production app against the running test backend (see start.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-/tmp/shifa-dev-backend}"
cd "$ROOT"
pgrep -f '^next-server' | xargs -r kill || true
sleep 1
# load the test backend settings BEFORE building: some bundles (middleware) inline NEXT_PUBLIC_* at build time,
# and a shell/CI environment may already carry real project values that must never be used by the local tests.
set -a; . "$WORK/env"; set +a
rm -rf .next
NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | grep -E "Compiled|rror" || true
(NEXT_TELEMETRY_DISABLED=1 nohup npx next start -p 3000 -H 127.0.0.1 > /tmp/next.log 2>&1 &)
for i in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:3000/login && break; sleep 0.5; done
echo "app ready on :3000"
