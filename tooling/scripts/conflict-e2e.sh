#!/usr/bin/env bash
#
# Keep-both-konflikt-E2E (#742) — UI-driven, mot den FULLA self-hosted-stacken
# (server-first tRPC + oauth2-proxy + Keycloak på en origin, :8080).
#
# Flöde:
#   1. bygg server-first-binär + statisk app (out/)
#   2. starta stacken (postgres + server-first + keycloak + oauth2-proxy + web)
#   3. migrera + seeda org + 2 allowlistade användare (lawyer + admin)
#   4. conflict-seed.ts: provocera en RIKTIG dokument-konflikt över helperns
#      nätväg (Keycloak-Bearer → oauth2-proxy → server-first) → keep-both-syskon
#   5. Playwright: logga in via Keycloak-formuläret, navigera till ärendet,
#      bekräfta i UIt att 2 filer finns (original + "(din ändring …)")
#
# Kräver: docker, bun, playwright chromium (`bun run e2e:install`). Kör ensamt
# (samma 8080/8089-portar som OIDC-e2e:t) — egen compose-projekt-namn.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:$PATH"

export AVA_WEB_PORT="${AVA_WEB_PORT:-8080}"
export KC_PORT="${KC_PORT:-8089}"
export AVA_WEB_URL="http://localhost:${AVA_WEB_PORT}"
export OIDC_KC_HOSTNAME="http://localhost:${KC_PORT}"
export OIDC_ISSUER_PUBLIC="http://localhost:${KC_PORT}/realms/ava"
export OIDC_REDIRECT_URL="http://localhost:${AVA_WEB_PORT}/oauth2/callback"
export AVA_ORGANIZATION_ID="${AVA_ORGANIZATION_ID:-00000000-0000-0000-0000-000000000001}"
export AVA_CONTENT_HOST_DIR="${AVA_CONTENT_HOST_DIR:-$ROOT/tooling/docker/.conflict-e2e-content}"
DB_URL="postgres://ava:ava@localhost:5433/ava_test"
PROJECT="${CONFLICT_E2E_PROJECT:-ava-conflict-e2e}"
COMPOSE=(docker compose -p "$PROJECT" -f tooling/docker/docker-compose.selfhosted-local.yml)

# Fast bordet rent: fixed-id-ärendet (#742-seeden) raderas så re-körning är idempotent.
MATTER_ID="019ef800-0000-7000-8000-000000000742"

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  # Content-dir:en fylls av server-first-containern (root) → host-rm kan nekas.
  # Försök som vanlig användare, annars sudo (CI-runner), annars strunta i det.
  rm -rf "$AVA_CONTENT_HOST_DIR" 2>/dev/null \
    || sudo rm -rf "$AVA_CONTENT_HOST_DIR" 2>/dev/null \
    || true
}
trap cleanup EXIT

mkdir -p "$AVA_CONTENT_HOST_DIR"

echo "==> [1/6] Bygger server-first-binär + statisk app (out/)…"
bun run server-first:build >/dev/null
bun run build:demo >/dev/null 2>&1

echo "==> [2/6] Startar self-hosted-stacken (postgres + server-first + keycloak + oauth2-proxy + web)…"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 240 postgres server-first keycloak oauth2-proxy web

echo "==> [3/6] Migrerar + seedar org + allowlistade användare (lawyer + admin)…"
AVA_DATABASE_URL="$DB_URL" bun run db:migrate
AVA_DATABASE_URL="$DB_URL" AVA_ORGANIZATION_ID="$AVA_ORGANIZATION_ID" bun tooling/scripts/seed-selfhosted-local.ts

echo "==> [4/6] Väntar in Keycloak + web-origin…"
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${KC_PORT}/realms/ava/.well-known/openid-configuration" >/dev/null 2>&1 \
     && curl -sf "http://localhost:${AVA_WEB_PORT}/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
done

# Idempotent: rensa ev. tidigare konflikt-ärende (fixed id) innan seeden.
docker exec "${PROJECT}-postgres-1" psql -U ava -d ava_test -q \
  -c "DELETE FROM documents WHERE matter_id='${MATTER_ID}'; DELETE FROM matters WHERE id='${MATTER_ID}';" >/dev/null 2>&1 || true

echo "==> [5/6] Provocerar dokument-konflikt (2 användare, helperns nätväg)…"
AVA_WEB_URL="$AVA_WEB_URL" OIDC_KC_HOSTNAME="$OIDC_KC_HOSTNAME" bun tooling/scripts/conflict-seed.ts

echo "==> [6/6] Kör Playwright (UI-driven verifiering)…"
AVA_WEB_URL="$AVA_WEB_URL" bun run playwright test --config tooling/config/playwright.conflict.config.ts
echo "✅ keep-both-konflikt-E2E klart."
