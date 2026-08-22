#!/usr/bin/env bash
#
# Självständig runner för fakturerings-E2E:n (server-first-stacken).
# Bygger binären, startar Postgres + server-first i docker, migrerar, kör
# `billing-pipeline-e2e.ts` och river ner. Speglar `document-pipeline-e2e.sh`
# och CI:s server-first-jobb (docker-compose.server-first.yml).
#
#   bash tooling/scripts/billing-pipeline-e2e.sh
#
# Täcker: fakturering (tid → slutfaktura, frysning, moms, OCR), avbetalning
# enligt plan (INSTALLMENT_PLAN → PAID + COMPLETED) och avbetalning som inte
# kommer i tid (DUE → OVERDUE, idempotent scan).
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

echo "▸ Kör fakturerings-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/billing-pipeline-e2e.ts
