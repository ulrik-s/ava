#!/usr/bin/env bash
#
# DEPLOY på produktionsservern (#1166) — ett kommando i stället för ett recept
# man skriver för hand (och glömmer steg i).
#
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh
#
# Steg:
#   1. vägra om ett annat bygge redan kör
#   2. backup (systemd-tjänsten ava-backup, annars backup-db.sh)
#   3. uppdatera till origin/main (bara fast-forward)
#   4. TÖM .next/cache — en gammal byggcache gav en gång gammal CSS i prod
#   5. bygg server + klient i oven/bun (hosten har bara docker + git)
#   6. kontrollera att den byggda CSS:en har allt ur globals.css — annars
#      avbryts deployen INNAN något startas om
#   7. kör nya databasmigrationer (om deployen har några; backup är tagen)
#   8. starta om tjänsterna och vänta tills /readyz svarar
set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE="tooling/docker/docker-compose.production.yml"
dc() { docker compose -f "$COMPOSE" "$@"; }
step() { printf '\n==> %s\n' "$*"; }

step "kontrollerar att inget annat bygge kör"
if [ -n "$(docker ps -q --filter ancestor=oven/bun:1)" ]; then
  echo "ett annat bygge (oven/bun) kör redan — avbryter" >&2
  exit 1
fi

step "backup"
if systemctl cat ava-backup.service >/dev/null 2>&1; then
  systemctl start ava-backup.service
  echo "backup: $(systemctl show -p Result --value ava-backup.service)"
else
  bash tooling/scripts/backup-db.sh backup
fi

step "uppdaterar till origin/main"
before="$(git rev-parse HEAD)"
git fetch -q origin
git merge --ff-only origin/main >/dev/null
git log --oneline -1
new_migrations="$(git diff --name-only "$before" HEAD -- tooling/db/migrations)"

step "tömmer Next byggcache (.next/cache)"
rm -rf .next/cache

step "bygger (oven/bun)"
docker run --rm -v "$PWD:/app" -w /app -e DEMO_BASE_PATH= oven/bun:1 sh -c \
  'bun install --frozen-lockfile >/dev/null && bun run server-first:build >/dev/null && bash tooling/scripts/build-demo.sh >/tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }'

step "kontrollerar byggd CSS mot globals.css"
bash tooling/scripts/check-built-css.sh src/app/globals.css out/_next/static/chunks/*.css

if [ -n "$new_migrations" ]; then
  step "kör nya databasmigrationer"
  printf '%s\n' "$new_migrations"
  set -a && . ./ava-server.env && set +a
  docker run --rm --network ava_default -v "$PWD:/app" -w /app \
    -e AVA_DATABASE_URL="postgres://${POSTGRES_USER:-ava}:$POSTGRES_PASSWORD@postgres:5432/${POSTGRES_DB:-ava}" \
    oven/bun:1 bun tooling/scripts/db-migrate.ts
fi

step "startar om tjänsterna"
dc up -d --build
dc restart caddy

step "väntar på /readyz"
for _ in $(seq 1 30); do
  if dc exec -T caddy wget -q -O- http://server-first:3001/readyz 2>/dev/null | grep -q '"status":"ok"'; then
    dc ps --format '{{.Service}} {{.Status}}'
    echo "deploy klar: $(git log --oneline -1)"
    exit 0
  fi
  sleep 2
done
echo "/readyz svarar inte ok efter 60 s — kontrollera: docker compose -f $COMPOSE logs server-first" >&2
exit 1
