#!/usr/bin/env bash
#
# Självständig runner för camt-betalnings-E2E:n (server-first-stacken).
#
#   bash tooling/scripts/camt-payment-e2e.sh
#
# Kör hela kedjan bankfil → parser → matchning → bokförd betalning, för BÅDA
# referensvägarna: OCR (strukturerad, klientens fakturabetalning) och fri text
# (domstolens utbetalning mot en förväntad fordran). Sista steget importerar om
# exakt samma fil och kräver att ingenting bokförs en andra gång.
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

echo "▸ Kör camt-betalnings-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/camt-payment-e2e.ts
