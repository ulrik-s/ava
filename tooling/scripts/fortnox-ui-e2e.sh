#!/usr/bin/env bash
#
# Fortnox UI-E2E (#1173) — skapa klient, ärende, faktura och delbetalningar i
# webb-UIt, bokför med "Bokför i Fortnox" och kontrollera i Fortnox (API) att
# verifikaten blev rätt. Körs mot CI:s Fortnox-sandbox (egen serie + eget
# räkenskapsår), med samma secrets som övriga Fortnox-jobb.
#
#   1. bygg + starta den fulla self-hosted-stacken (samma som conflict-e2e)
#   2. prepare: anslut med CI:s refresh-token → valv → `docker cp` in i servern
#   3. Playwright: allt i UIt
#   4. verify: läs tillbaka verifikaten, balans + kundfordran = 0 + delta
#
# Kräver env: AVA_FORTNOX_CLIENT_ID/_SECRET/_REFRESH_TOKEN, AVA_FORTNOX_BOOKING_WINDOW
# (+ valfria AVA_FORTNOX_VOUCHER_SERIES/_KONTO_*/_ACCOUNT_TYPE). Docker, bun, chromium.
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
export AVA_CONTENT_HOST_DIR="${AVA_CONTENT_HOST_DIR:-$ROOT/tooling/docker/.fortnox-ui-content}"
export AVA_DATABASE_URL="postgres://ava:ava@localhost:5433/ava_test"
AVA_SECRETS_KEY="${AVA_SECRETS_KEY:-$(openssl rand -base64 32)}"
export AVA_SECRETS_KEY
PROJECT="${FORTNOX_UI_E2E_PROJECT:-ava-fortnox-ui-e2e}"
SERVER="${PROJECT}-server-first-1"
COMPOSE=(docker compose -p "$PROJECT" -f tooling/docker/docker-compose.selfhosted-local.yml)

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$AVA_CONTENT_HOST_DIR" 2>/dev/null || sudo rm -rf "$AVA_CONTENT_HOST_DIR" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$AVA_CONTENT_HOST_DIR"

echo "==> [1/5] Bygger + startar stacken…"
bun run server-first:build >/dev/null
bun run build:demo >/dev/null 2>&1
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 240 postgres server-first keycloak oauth2-proxy web
bun run db:migrate
bun tooling/scripts/seed-selfhosted-local.ts
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${KC_PORT}/realms/ava/.well-known/openid-configuration" >/dev/null 2>&1 \
     && curl -sf "${AVA_WEB_URL}/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "==> [2/5] Ansluter Fortnox (CI:s refresh-token) och lämnar över tokens till servern…"
bun tooling/scripts/fortnox-ui-harness.ts prepare
docker exec "$SERVER" mkdir -p /data/secrets
docker cp tooling/.fortnox-ui/vault.enc "$SERVER:/data/secrets/vault.enc"

echo "==> [3/5] Playwright: klient → ärende → faktura → delbetalningar → Bokför i Fortnox…"
status=0
bun run playwright test --config tooling/config/playwright.fortnox.config.ts || status=$?

echo "==> [4/5] Hämtar serverns valv (token kan ha roterat)…"
docker cp "$SERVER:/data/secrets/vault.enc" tooling/.fortnox-ui/vault.enc
[ "$status" -eq 0 ] || { echo "❌ UI-delen fallerade"; exit "$status"; }

echo "==> [5/5] Kontrollerar verifikaten i Fortnox…"
bun tooling/scripts/fortnox-ui-harness.ts verify
echo "✅ Fortnox UI-E2E klart."
