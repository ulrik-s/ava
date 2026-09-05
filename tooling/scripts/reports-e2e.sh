#!/usr/bin/env bash
#
# Självständig runner för rapport-E2E:n (server-first-stacken).
# Bygger binären, startar Postgres + server-first i docker, migrerar, kör
# `reports-e2e.ts` och river ner.
#
#   bash tooling/scripts/reports-e2e.sh
#
# Stämmer av reports.perLawyer/firmOverview/arSummary/billed mot det testet
# självt matade in: fem ärenden där varje faktura fyller exakt en term i
# kundfordringsbryggan (betald, delbetald, krediterad, avskriven, ofakturerad).
# Allt ligger i år 2025, som inget annat e2e rör — därför kan org-breda
# rapporter asserteras på absoluta belopp utan att databasen töms.
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

echo "▸ Kör rapport-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/reports-e2e.ts
