#!/usr/bin/env bash
#
# Caddy-E2E för #1352: den RIKTIGA prod-Caddyfile:n (caddy:2-alpine, samma
# releases/-mount som docker-compose.production.yml) framför klienten.
#
#   bash tooling/scripts/caddy-e2e/caddy-prod-e2e.sh
#   AVA_CADDY_E2E_OUT=out AVA_CADDY_E2E_NETWORK=ava-server-first_default \
#   AVA_CADDY_E2E_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
#     bash tooling/scripts/caddy-e2e/caddy-prod-e2e.sh
#
# 1. Releasen får allt ett demo-bygge lägger i out/ (som en release byggd före
#    #1352, t.ex. efter --rollback). Demodatan ska ge 404; skalet,
#    PWA-manifestet och shell-rewriten för runtime-id:n ska svara 200.
# 2. Med AVA_CADDY_E2E_OUT (prod-bygget, AVA_BUILD_TARGET=server) serveras det
#    bygget, och en Playwright-smoke kör den self-hostade appen i en browser
#    genom Caddy: inga 404/5xx på samma origin. Med AVA_CADDY_E2E_NETWORK
#    (docker-nätet där server-first kör) går /api till den riktiga servern.
#    oauth2-proxy är en låtsas-proxy (oauth2-proxy-stub.ts) — ingen IdP. Med
#    AVA_CADDY_E2E_DATABASE_URL seedas E2E-användaren som admin via repo-lagret
#    (seed-selfhosted-local.ts, som i prod), så klienten kan binda den.
#
# Kräver docker + curl (+ Playwright-browsern för steg 2).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PORT="${AVA_CADDY_E2E_PORT:-18352}"
OUT_DIR="${AVA_CADDY_E2E_OUT:-}"
NETWORK="${AVA_CADDY_E2E_NETWORK:-}"
DATABASE_URL="${AVA_CADDY_E2E_DATABASE_URL:-}"
EMAIL="caddy-e2e@byra.se"
TAG="ava-caddy-e2e-$$"
WORK="$(mktemp -d)"
OWN_NETWORK=""
FAILS=0

cleanup() {
  docker rm -f "$TAG-caddy" "$TAG-oauth2" >/dev/null 2>&1 || true
  [ -z "$OWN_NETWORK" ] || docker network rm "$OWN_NETWORK" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

RELEASE="$WORK/releases/r1"
mkdir -p "$WORK/releases"
if [ -n "$OUT_DIR" ]; then
  cp -R "$OUT_DIR" "$RELEASE"
else
  mkdir -p "$RELEASE/matters/__shell__"
  printf 'skal' > "$RELEASE/index.html"
  printf '__shell__' > "$RELEASE/matters/__shell__/index.html"
  printf '{"name":"AVA"}' > "$RELEASE/manifest.json"
fi
plant() { mkdir -p "$(dirname "$RELEASE/$1")" && printf '{}' > "$RELEASE/$1"; }
for f in demo-seed.json .ava/meta.json .ava/users/anna@ava.demo.json matters/active/m1.json \
  contacts/c1.json documents/d1.json documents/content/stamning.pdf; do
  plant "$f"
done
ln -s r1 "$WORK/releases/current"
chmod -R a+rX "$WORK"

if [ -z "$NETWORK" ]; then
  OWN_NETWORK="$TAG"
  NETWORK="$TAG"
  docker network create "$NETWORK" >/dev/null
fi

if [ -n "$DATABASE_URL" ]; then
  AVA_DATABASE_URL="$DATABASE_URL" AVA_ADMIN_EMAIL="$EMAIL" AVA_ADMIN_NAME="Caddy E2E" \
    bun "$ROOT/tooling/scripts/seed-selfhosted-local.ts"
fi

docker run -d --name "$TAG-oauth2" --network "$NETWORK" --network-alias oauth2-proxy -e AVA_STUB_EMAIL="$EMAIL" \
  -v "$ROOT/tooling/scripts/caddy-e2e/oauth2-proxy-stub.ts:/stub.ts:ro" \
  oven/bun:1 bun /stub.ts >/dev/null
docker run -d --name "$TAG-caddy" --network "$NETWORK" -p "127.0.0.1:$PORT:80" -e AVA_DOMAIN=:80 \
  -v "$ROOT/tooling/docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$WORK/releases:/srv/releases:ro" \
  caddy:2-alpine >/dev/null

BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 30); do
  curl -fsS "$BASE/healthz" >/dev/null 2>&1 && curl -fsS "$BASE/oauth2/userinfo" >/dev/null 2>&1 && break
  sleep 1
done

expect_code() {
  local want="$1" path="$2" got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  if [ "$got" = "$want" ]; then
    echo "ok   $got $path"
  else
    echo "FEL  $got $path (väntade $want)" >&2
    FAILS=$((FAILS + 1))
  fi
}

# Shell-rewriten ska ge __shell__-sidan, inte startsidan (som också svarar 200).
# Den pre-renderade shellen bär segmentet i sin RSC-payload; startsidan inte.
expect_shell() {
  local body
  body="$(curl -s "$BASE$1")"
  if [[ "$body" == *__shell__* ]]; then
    echo "ok   shell $1"
  else
    echo "FEL  $1 gav inte __shell__-sidan" >&2
    FAILS=$((FAILS + 1))
  fi
}

expect_code 404 /demo-seed.json
expect_code 404 /.ava/meta.json
expect_code 404 /.ava/users/anna@ava.demo.json
expect_code 404 /matters/active/m1.json
expect_code 404 /contacts/c1.json
expect_code 404 /documents/d1.json
expect_code 404 /documents/content/stamning.pdf
expect_code 200 /
expect_code 200 /manifest.json
expect_code 200 /matters/0fb22dd8-566b-566e-9dfc-4238f1941b67/
expect_shell /matters/0fb22dd8-566b-566e-9dfc-4238f1941b67/
expect_code 200 /oauth2/userinfo

if [ -n "$OUT_DIR" ] && [ "$FAILS" -eq 0 ]; then
  AVA_PROD_CLIENT_BASE_URL="$BASE" npx playwright test --config "$ROOT/tooling/config/playwright.prod-client.config.ts" ||
    FAILS=$((FAILS + 1))
fi

if [ "$FAILS" -ne 0 ]; then
  docker logs "$TAG-caddy" 2>&1 | tail -20 >&2
  exit 1
fi
echo "Caddy: demodata nekas, prod-klienten fungerar (#1352)."
