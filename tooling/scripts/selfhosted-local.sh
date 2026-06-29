#!/usr/bin/env bash
#
# Lokal SELF-HOSTED-stack för manuellt test (#626): hela kedjan på en origin —
# nginx (:8080) → statisk app + /api/trpc → server-first (Postgres) bakom
# oauth2-proxy + Keycloak (:8089). Lämnas KÖRANDE (ingen teardown).
#
#   bash tooling/scripts/selfhosted-local.sh          # starta (tom byrå) + lämna uppe
#   bash tooling/scripts/selfhosted-local.sh --demo    # + fyll med demodata
#   bash tooling/scripts/selfhosted-local.sh --down    # riv ner
#
# Login (Keycloak realm "ava"): lawyer/lawyer (allowlistad) · admin/admin ·
# outsider/outsider (nekas — ej i allowlisten). Verifierad principal-bindning.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:$PATH"

export AVA_WEB_PORT="${AVA_WEB_PORT:-8080}"
export KC_PORT="${KC_PORT:-8089}"
export OIDC_KC_HOSTNAME="http://localhost:${KC_PORT}"
export OIDC_ISSUER_PUBLIC="http://localhost:${KC_PORT}/realms/ava"
export OIDC_REDIRECT_URL="http://localhost:${AVA_WEB_PORT}/oauth2/callback"
export AVA_ORGANIZATION_ID="${AVA_ORGANIZATION_ID:-00000000-0000-0000-0000-000000000001}"
# Dokument-bytes (#649): host-katalog som bind-mountas till serverns
# AVA_CONTENT_DIR. Demo-seeden skriver hit, serverns GitContentStore läser hit.
export AVA_CONTENT_HOST_DIR="${AVA_CONTENT_HOST_DIR:-$ROOT/tooling/docker/.selfhosted-content}"
DB_URL="postgres://ava:ava@localhost:5433/ava_test"
COMPOSE=(docker compose -p ava-selfhosted-local -f tooling/docker/docker-compose.selfhosted-local.yml)

if [[ "${1:-}" == "--down" ]]; then
  echo "▸ River ner self-hosted-stacken…"
  "${COMPOSE[@]}" down -v --remove-orphans
  rm -rf "$AVA_CONTENT_HOST_DIR"
  exit 0
fi

mkdir -p "$AVA_CONTENT_HOST_DIR" # bind-mount-måletet måste finnas innan `up`

echo "▸ [1/6] Bygger server-first-binär…"
bun run server-first:build >/dev/null

echo "▸ [2/6] Bygger statisk app (out/)…"
bun run build:demo >/dev/null 2>&1

echo "▸ [3/6] Startar stacken (postgres + server-first + keycloak + oauth2-proxy + web)…"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 240

echo "▸ [4/6] Migrerar schemat…"
AVA_DATABASE_URL="$DB_URL" bun run db:migrate

if [[ "${1:-}" == "--demo" ]]; then
  # --demo: skapa bara org:en här — demo-seeden mappar sin admin + huvud-jurist
  # till KC-login-emailen (admin@/lawyer@ava.test) och äger datan (dashboarden
  # fylls för den inloggade). Separata allowlist-users skulle bli dubbletter.
  echo "▸ [5/6] Seedar org (login-users kommer från demodatan)…"
  SEED_ORG_ONLY=1 AVA_DATABASE_URL="$DB_URL" AVA_ORGANIZATION_ID="$AVA_ORGANIZATION_ID" bun tooling/scripts/seed-selfhosted-local.ts
  # Bulk-datan seedas via serverns HTTP-API (#846) — testar transport + oauth2-
  # proxy/Bearer + routrar, inte bara in-process. Override: AVA_SEED_VIA_HTTP=0.
  echo "▸ [5b] Fyller byrån med demodata via HTTP-API:t (ärenden/kontakter/tid/uppgifter…)…"
  AVA_SEED_VIA_HTTP="${AVA_SEED_VIA_HTTP:-1}" OIDC_KC_HOSTNAME="$OIDC_KC_HOSTNAME" AVA_WEB_ORIGIN="http://localhost:${AVA_WEB_PORT}" \
    AVA_DATABASE_URL="$DB_URL" AVA_ORGANIZATION_ID="$AVA_ORGANIZATION_ID" bun tooling/scripts/seed-demo-into-server.ts
else
  echo "▸ [5/6] Seedar org + allowlistade användare…"
  AVA_DATABASE_URL="$DB_URL" AVA_ORGANIZATION_ID="$AVA_ORGANIZATION_ID" bun tooling/scripts/seed-selfhosted-local.ts
fi

echo "▸ [6/6] Väntar in Keycloak + web…"
for _ in $(seq 1 40); do
  if curl -sf "http://localhost:${KC_PORT}/realms/ava/.well-known/openid-configuration" >/dev/null 2>&1 \
     && curl -sf "http://localhost:${AVA_WEB_PORT}/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
done

# Sanity: /api/trpc ska finnas + vara auth-gated (401 utan cookie, ej 404).
API_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "http://localhost:${AVA_WEB_PORT}/api/trpc/user.current" 2>/dev/null || echo "ERR")

cat <<EOF

✅ Self-hosted-stacken kör.

   Öppna:   http://localhost:${AVA_WEB_PORT}/ava
   Login:   lawyer / lawyer   (eller admin / admin)
            outsider / outsider → nekas (ej i byråns allowlist)
   Keycloak admin: http://localhost:${KC_PORT}  (admin/admin)

   /api/trpc auth-gate (utan cookie): HTTP ${API_CODE}  (401 = rätt: finns + skyddad)

   Riv ner:  bash tooling/scripts/selfhosted-local.sh --down
EOF
