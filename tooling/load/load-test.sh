#!/usr/bin/env bash
#
# Lasttest mot server-first i docker (#1366).
#
#   1. bygg server-first-binären (hoppa med LOAD_SKIP_BUILD=1)
#   2. starta Postgres, skapa en databas per byrå och migrera
#   3. starta en server-first-container per byrå (pg-boss i varje)
#   4. kör tooling/load/run.ts (virtuella användare med den riktiga synk-klienten)
#   5. spara containerloggarna bredvid rapporten och riv stacken (LOAD_KEEP=1 behåller den)
#
#   bun run load:test                    # 20 användare, 2 byråer, ~5 min
#   bun run load:test:50                 # 50 användare, 3 byråer
#   LOAD_SOAK=1 bun run load:test        # vanligt arbete i 30 min
#
# Egna portar och eget compose-projekt, så att det inte krockar med en lokal
# stack eller en annan worktree: LOAD_COMPOSE_PROJECT, LOAD_PG_PORT, LOAD_PORT_BASE.
# Exit-koden är lasttestets: 0 = alla krav uppfyllda, 1 = krav bröts, 2 = avbrott.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:$PATH"

export LOAD_ORGS="${LOAD_ORGS:-2}"
export LOAD_PG_PORT="${LOAD_PG_PORT:-55433}"
export LOAD_PORT_BASE="${LOAD_PORT_BASE:-53100}"
export LOAD_REPORT_DIR="${LOAD_REPORT_DIR:-reports/load}"
for i in 1 2 3; do export "LOAD_PORT_$i=$((LOAD_PORT_BASE + i))"; done
PROJECT="${LOAD_COMPOSE_PROJECT:-ava-load}"
COMPOSE=(docker compose -p "$PROJECT" -f tooling/docker/docker-compose.load.yml)

# Byrå 2 och 3 är profiler i compose-filen.
profiles=""
[ "$LOAD_ORGS" -ge 2 ] && profiles="org2"
[ "$LOAD_ORGS" -ge 3 ] && profiles="org2,org3"
[ -n "${AVA_LLM_ENDPOINT:-}" ] && profiles="${profiles:+$profiles,}llm"
export COMPOSE_PROFILES="$profiles"

cleanup() {
  mkdir -p "$LOAD_REPORT_DIR"
  "${COMPOSE[@]}" logs --no-color >"$LOAD_REPORT_DIR/containers.log" 2>&1 || true
  if [ "${LOAD_KEEP:-0}" = "1" ]; then
    echo "[lasttest] stacken står kvar (LOAD_KEEP=1): ${COMPOSE[*]} down -v"
  else
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "${LOAD_SKIP_BUILD:-0}" != "1" ]; then
  bun run server-first:build
fi

echo "[lasttest] startar Postgres ($PROJECT, port $LOAD_PG_PORT) …"
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres

PG_ADMIN="postgres://ava:ava@localhost:${LOAD_PG_PORT}/ava_load_admin"
for i in $(seq 1 "$LOAD_ORGS"); do
  db="ava_load_$i"
  "${COMPOSE[@]}" exec -T postgres psql -U ava -d ava_load_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1 \
    || "${COMPOSE[@]}" exec -T postgres psql -U ava -d ava_load_admin -c "CREATE DATABASE $db" >/dev/null
  AVA_DATABASE_URL="postgres://ava:ava@localhost:${LOAD_PG_PORT}/$db" bun run db:migrate
done
echo "[lasttest] Postgres klar ($PG_ADMIN, $LOAD_ORGS byråer)"

echo "[lasttest] startar server-first ($LOAD_ORGS containrar) …"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 180

LOAD_CONTAINERS="$("${COMPOSE[@]}" ps -q | paste -sd, -)"
LOAD_PG_CONTAINER="$("${COMPOSE[@]}" ps -q postgres)"
export LOAD_CONTAINERS LOAD_PG_CONTAINER

set +e
bun tooling/load/run.ts
status=$?
set -e
exit "$status"
