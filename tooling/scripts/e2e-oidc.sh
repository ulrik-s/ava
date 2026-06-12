#!/usr/bin/env bash
# OIDC-e2e (#222): bygg upp OIDC-stacken (web + oauth2-proxy + Keycloak med
# test-realm) och kör Playwright-batteriet som loggar in via Keycloaks RIKTIGA
# login mot oauth2-proxy. Browser-oberoende verifiering finns i README/docs;
# detta kör den fulla token-dansen.
#
# Kräver: docker, bun, playwright chromium (`bun run e2e:install`).
# OBS lokal Mac: Docker Desktop kan ge flakiga browser→port-anslutningar; kör
# i CI (linux) för deterministiskt resultat (samma mönster som round-trip).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT="${OIDC_E2E_PROJECT:-ava-oidc-e2e}"
export AVA_WEB_PORT="${AVA_WEB_PORT:-8088}"
export KC_PORT="${KC_PORT:-8089}"
export AVA_OIDC_BASE_URL="http://localhost:${AVA_WEB_PORT}"
COMPOSE=(docker compose -p "$PROJECT" -f tooling/docker/docker-compose.yml -f tooling/docker/docker-compose.oidc.yml)

cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> [1/4] Bygger + startar OIDC-stacken (web:${AVA_WEB_PORT}, keycloak:${KC_PORT})…"
"${COMPOSE[@]}" up -d --build web oauth2-proxy keycloak

echo "==> [2/4] Väntar in Keycloak (realm-import + discovery)…"
kc_ready=""
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${KC_PORT}/realms/ava/.well-known/openid-configuration" >/dev/null 2>&1; then kc_ready=1; break; fi
  sleep 3
done
[ -n "$kc_ready" ] || { echo "❌ Keycloak blev aldrig redo"; "${COMPOSE[@]}" logs keycloak | tail -40; exit 1; }

echo "==> [3/4] Väntar in web (healthy)…"
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "${PROJECT}-web-1" 2>/dev/null)" = "healthy" ] && break
  sleep 2
done

echo "==> [4/4] Kör Playwright OIDC-batteri…"
bun run playwright test --config tooling/config/playwright.oidc.config.ts
echo "✅ OIDC-e2e klart."
