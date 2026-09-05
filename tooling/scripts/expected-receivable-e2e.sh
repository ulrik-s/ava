#!/usr/bin/env bash
#
# Självständig runner för domstolsbetalning-E2E:n (server-first-stacken).
#
#   bash tooling/scripts/expected-receivable-e2e.sh
#
# Täcker: försiktighetsprincipen 3b-ii (begärt belopp är memo, bara utbetalt
# bokas, kundfordringsbryggan lämnas orörd), sömmen mellan serverns
# `candidates` och den skarpa camt-matchningen (#175) med verifierat
# referensformat, samt att en avprickad eller avbruten fordran försvinner ur
# kandidatlistan så en omimporterad camt-fil inte kan pricka av två gånger.
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

echo "▸ Kör domstolsbetalning-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/expected-receivable-e2e.ts
