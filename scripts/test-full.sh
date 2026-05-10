#!/usr/bin/env bash
# Kör HELA testsviten — unit + scripts + E2E.
#
# Kräver Docker (postgres + meilisearch + tika kommer dras upp via
# docker-compose). Playwright spinner upp Next-servern själv.
#
# Använd: `npm run test:full`

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Startar docker-compose-stack (postgres, meilisearch, tika)"
docker compose up -d

echo "==> Väntar på Postgres (max 60s)"
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U ava >/dev/null 2>&1; then
    echo "    Postgres redo."
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "    Postgres svarar inte efter 60s — avbryter."
    exit 1
  fi
done

echo "==> Synkar schema (db push, idempotent)"
yarn prisma db push --accept-data-loss

echo "==> Vitest (unit + scripts)"
npx vitest run --config config/vitest.config.ts

echo "==> Playwright E2E"
npx playwright test --config config/playwright.config.ts

echo "==> Klart."
