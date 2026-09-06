#!/usr/bin/env bash
#
# Självständig runner för Graph mail-E2E:n (#1074).
#
#   AVA_MS_CLIENT_ID=… AVA_MS_CLIENT_SECRET=… AVA_MS_TENANT_ID=… \
#   AVA_MS_REFRESH_TOKEN=… AVA_MS_TEST_MAILBOX=… \
#     bash tooling/scripts/msgraph-mail-e2e.sh
#
# Kör hela kedjan sendMail → polla → $value (rå MIME) → mail.saveIncoming mot
# en riktig AVA-stack → läs tillbaka och jämför byte för byte.
#
# OBS: refresh-token:en ROTERAR i första anropet. Kör du det här lokalt är
# secreten i `ms-graph`-miljön oförändrad, men DIN lokala token är förbrukad —
# använd `bun run ms:connect --listen` för att hämta en ny.
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

echo "▸ Kör Graph mail-E2E…"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="$DB_URL" \
AVA_ORGANIZATION_ID="$ORG" \
  bun tooling/scripts/msgraph-mail-e2e.ts
