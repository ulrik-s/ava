#!/usr/bin/env bash
# Strukturellt röktest för OIDC-stacken (#222).
#
# Verifierar att wiringen nginx auth_request → oauth2-proxy → mock-OIDC är
# korrekt UTAN att skripta hela browser-token-dansen (den dual-URL-biten kräver
# en riktig IdP / browser och valideras manuellt). Det vi bevisar:
#   1. compose-overlayen är giltig,
#   2. oauth2-proxy startar = den hämtade mock-OIDC:s discovery-dokument
#      (provider=oidc vägrar starta annars),
#   3. oskyddad request mot appen → 302 till /oauth2/start (auth_request gat:ar),
#   4. /oauth2/start → 302 till IdP:ns authorize-endpoint (provider-wiring).
# Kräver docker. Isolerat projektnamn så det inte krockar med en körande stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PROJECT="ava-oidc-smoke"
# Egen host-port (default-stacken kör på 8080) så röktestet inte krockar.
PORT="${AVA_WEB_PORT:-8088}"
export AVA_WEB_PORT="$PORT"
COMPOSE=(docker compose -p "$PROJECT" -f tooling/docker/docker-compose.yml -f tooling/docker/docker-compose.oidc.yml)

cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> [1/4] Validerar compose-overlay…"
"${COMPOSE[@]}" config >/dev/null
echo "    ok"

echo "==> [2/4] Startar web + oauth2-proxy + mock-oidc…"
"${COMPOSE[@]}" up -d --build web oauth2-proxy mock-oidc >/dev/null 2>&1

echo "==> [3/4] Väntar in oauth2-proxy (hämtar mock-OIDC discovery)…"
ok=""
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/ava/" || true)
  loc=$(curl -s -o /dev/null -w '%{redirect_url}' "http://localhost:${PORT}/ava/" || true)
  if [ "$code" = "302" ] && printf '%s' "$loc" | grep -q "/oauth2/start"; then ok="1"; break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "❌ FEL: /ava/ gav inte 302→/oauth2/start (code=$code loc=$loc)"
  "${COMPOSE[@]}" logs oauth2-proxy mock-oidc | tail -40
  exit 1
fi
echo "    /ava/ → 302 $loc  ✓ (auth_request gat:ar + oauth2-proxy uppe)"

echo "==> [4/4] /oauth2/start → IdP authorize…"
start_loc=$(curl -s -o /dev/null -w '%{redirect_url}' "http://localhost:${PORT}/oauth2/start?rd=%2Fava%2F" || true)
if ! printf '%s' "$start_loc" | grep -qiE "authorize|/default/"; then
  echo "❌ FEL: /oauth2/start pekade inte mot IdP authorize (loc=$start_loc)"
  exit 1
fi
echo "    /oauth2/start → $start_loc  ✓ (provider-wiring)"

echo "✅ OIDC-stack röktest OK — auth_request + oauth2-proxy + mock-OIDC korrekt wirat."
echo "   (Full token-dans valideras mot en riktig IdP — se docs/auth.md.)"
