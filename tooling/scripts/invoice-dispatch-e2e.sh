#!/usr/bin/env bash
#
# Självständig runner för fakturautskick-E2E:n (server-first-stacken).
#
#   bash tooling/scripts/invoice-dispatch-e2e.sh
#
# Täcker: livscykeln queued → sent → delivered med tidsstämplar, att ett
# MANUELLT utskick aldrig hamnar i workerns kö (dubbelutskick till klient),
# att köat/skickat flippar fakturan DRAFT → SENT (#392 — annars osynlig i
# kundfordringsbryggan), att ett misslyckat utskick bär sin orsak, och att ett
# utskick INTE ändrar statusen på en redan betald faktura.
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

echo "▸ Kör fakturautskick-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/invoice-dispatch-e2e.ts
