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
# 127.0.0.1 (ej "localhost") överallt → tvinga IPv4. Docker på linux binder
# bara IPv4 0.0.0.0:port; en browser som föredrar IPv6 ::1 får annars
# ERR_CONNECTION_REFUSED medan Node/curl (IPv4) lyckas. Konsekvent host krävs
# också för att OIDC-cookien (host-baserad) ska följa med callback:en.
HOST="${OIDC_PUBLIC_HOST:-127.0.0.1}"
export AVA_OIDC_BASE_URL="http://${HOST}:${AVA_WEB_PORT}"
export OIDC_KC_HOSTNAME="http://${HOST}:${KC_PORT}"
export OIDC_ISSUER_PUBLIC="http://${HOST}:${KC_PORT}/realms/ava"
export OIDC_REDIRECT_URL="http://${HOST}:${AVA_WEB_PORT}/oauth2/callback"
COMPOSE=(docker compose -p "$PROJECT" -f tooling/docker/docker-compose.yml -f tooling/docker/docker-compose.oidc.yml)

cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> [1/4] Bygger + startar OIDC-stacken (web:${AVA_WEB_PORT}, keycloak:${KC_PORT})…"
# --wait gatar på container-healthchecks (web blir healthy via /healthz).
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 180 web oauth2-proxy keycloak

echo "==> [2/4] Väntar in Keycloak (realm-import + discovery)…"
kc_ready=""
for _ in $(seq 1 60); do
  if curl -sf "http://${HOST}:${KC_PORT}/realms/ava/.well-known/openid-configuration" >/dev/null 2>&1; then kc_ready=1; break; fi
  sleep 3
done
[ -n "$kc_ready" ] || { echo "❌ Keycloak blev aldrig redo"; "${COMPOSE[@]}" logs keycloak | tail -40; exit 1; }

# KRITISKT: vänta tills HOST-portarna faktiskt servar (inte bara container-
# health) innan Playwright startar — annars hinner browsern (page.goto) träffa
# en kall port → ERR_CONNECTION_REFUSED, medan senare Node-requests lyckas.
# Samma host-curl-wait som round-trip-e2e:n gör.
echo "==> [3/4] Väntar in host-portar (web + keycloak servar)…"
web_ready=""
for _ in $(seq 1 60); do
  if curl -sf "http://${HOST}:${AVA_WEB_PORT}/healthz" >/dev/null 2>&1 \
     && curl -sf "http://${HOST}:${KC_PORT}/realms/ava/.well-known/openid-configuration" >/dev/null 2>&1; then
    web_ready=1; break
  fi
  sleep 2
done
[ -n "$web_ready" ] || { echo "❌ Host-portarna servade aldrig"; "${COMPOSE[@]}" ps; exit 1; }

echo "==> [4/4] Kör Playwright OIDC-batteri…"
bun run playwright test --config tooling/config/playwright.oidc.config.ts
echo "✅ OIDC-e2e klart."
