#!/usr/bin/env bash
# Kör scenario-baserade UI-tester lokalt mot full backend.
#
# Steg:
#   1. Säkerställ att docker-compose-services är uppe (postgres + meili + tika)
#   2. Vänta tills Postgres svarar
#   3. Synka schema (idempotent)
#   4. Seed:a databasen
#   5. Kör Playwright-scenarios med scenarios-specifik config
#
# Notera: Next.js dev-server startas av Playwright själv (se
# `config/playwright.scenarios.config.ts` → webServer). Behöver inte
# vara igång innan.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://ava:ava_dev_password@localhost:5432/ava?schema=public}"

bold() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[32m✓\033[0m %s\n" "$*"; }

bold "[1/4] Docker services — dev-stack (postgres, meili, tika)"
# Scenario-tester körs mot fat dev-stacken (postgres + tRPC), inte den
# tunna prod-stacken (nginx + sshd). Använd docker/docker-compose.dev.yml.
docker compose -f tooling/docker/docker-compose.dev.yml up -d postgres meilisearch tika

bold "[2/4] Väntar på Postgres"
for i in {1..30}; do
  if docker compose -f tooling/docker/docker-compose.dev.yml exec -T postgres pg_isready -U ava >/dev/null 2>&1; then
    ok "postgres redo"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "    Postgres svarar inte efter 60s — avbryter."
    exit 1
  fi
done

bold "[3/4] Synka schema + seed scenario-data"
yarn prisma db push --accept-data-loss >/dev/null
ok "schema synkat"
yarn tsx tooling/scripts/seed-scenario-data.ts | tail -6
ok "seed klar"

bold "[4/4] Playwright scenario-tester"
yarn playwright test --config tooling/config/playwright.scenarios.config.ts "$@"
