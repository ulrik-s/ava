#!/usr/bin/env bash
#
# Självständig runner för jävskontroll-E2E:n (server-first-stacken).
#
#   bash tooling/scripts/conflict-check-e2e.sh
#
# Testar underlaget jävskontrollen ska ge enligt Vägledande regler om god
# advokatsed: byråjäv (3.5 — träff i annan jurists ärende), "har biträtt"
# (3.2.1 p.1 — avslutade ärenden), identitet via personnummer trots namnbyte,
# fuzzy stavningsvariant, och dokumentationsplikten (varje kontroll loggad,
# även den utan träff).
set -euo pipefail

COMPOSE="tooling/docker/docker-compose.server-first.yml"
DB_URL="postgres://ava:ava@localhost:5433/ava_test"
ORG="00000000-0000-0000-0000-000000000001"

cleanup() { docker compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▸ Bygger server-first-binären…"
bun run server-first:build

echo "▸ Startar Postgres + server-first…"
docker compose -f "$COMPOSE" up -d --build --wait --wait-timeout 180

echo "▸ Applicerar schema…"
AVA_DATABASE_URL="$DB_URL" bun run db:migrate

echo "▸ Kör jävskontroll-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/conflict-check-e2e.ts
