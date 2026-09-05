#!/usr/bin/env bash
#
# Självständig runner för ärendeflora-E2E:n (server-first-stacken).
# Bygger binären, startar Postgres + server-first i docker, migrerar, kör
# `matter-flora-e2e.ts` och river ner. Speglar `billing-scenarios-e2e.sh`
# och CI:s server-first-jobb (docker-compose.server-first.yml).
#
#   bash tooling/scripts/matter-flora-e2e.sh
#
# Täcker BREDDEN: ett ärende per betalningssätt genom sitt eget flöde
# (PENDING/PRIVAT/MIX/OFFENTLIGT_UPPDRAG/RATTSSKYDD), avbetalningsplaner som
# sköts respektive havererar (kundförlust), kreditfaktura, utlägg med fyra
# momssatser och företagsklient. Djupet i täckningsärendena ligger kvar i
# `billing-scenarios-e2e.sh`.
#
# Fortnox-bokföringen ingår INTE här — den kräver credentials och skapar
# verifikat som inte går att ångra. Se workflow:et "Fortnox E2E".
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

echo "▸ Kör ärendeflora-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/matter-flora-e2e.ts
