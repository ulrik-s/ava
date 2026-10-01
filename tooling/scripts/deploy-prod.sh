#!/usr/bin/env bash
#
# DEPLOY på produktionsservern (#1166, #1369) — ett kommando i stället för ett
# recept man skriver för hand (och glömmer steg i).
#
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh             # deploy
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh --dry-run   # visa stegen, ändra inget
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh --rollback  # förra klienten tillbaka
#
# Steg:
#   1. vägra om ett annat bygge redan kör
#   2. uppdatera till origin/main (bara fast-forward); har deploy-skriptet
#      ändrats startas det om i den nya versionen
#   3. läs ava-server.env
#   4. backup (systemd-tjänsten ava-backup, annars backup-db.sh)
#   5. (en gång) flytta Caddy från out/ till releases/current
#   6. TÖM .next/cache — en gammal byggcache gav en gång gammal CSS i prod
#   7. bygg server + klient i oven/bun (hosten har bara docker + git) till
#      out/, som INTE serveras
#   8. kontrollera att den byggda CSS:en har allt ur globals.css
#   9. lägg bygget i releases/<tid>-<sha> (inte aktivt än)
#  10. kör databasmigrationerna — ALLTID: db-migrate kör bara filer som saknas
#      i schema_migrations, så en omkörning efter ett avbrott tar det som
#      återstår (förr avgjordes det med git diff, som var tomt vid omkörning)
#  11. starta om servern och vänta tills /readyz svarar
#  12. byt klient atomärt (releases/current), städa gamla releaser
#
# Skriptet går att köra om efter ett avbrott, var det än stannade: varje steg
# är idempotent. Avbryts det skriver det ut läget (kod, klient, server,
# databas). Klienten byts först när servern svarar — prod får aldrig ny klient
# mot gammal server. Se docs/deploy-server-first.md (Uppgradering, Rollback).
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=tooling/scripts/lib/release.sh
. tooling/scripts/lib/release.sh

COMPOSE="tooling/docker/docker-compose.production.yml"
CADDYFILE="tooling/docker/caddy/Caddyfile"
READY_TRIES="${AVA_DEPLOY_READY_TRIES:-30}"
READY_PAUSE="${AVA_DEPLOY_READY_PAUSE:-2}"
DRY_RUN=0
MODE=deploy

usage() {
  echo "användning: bash tooling/scripts/deploy-prod.sh [--dry-run] [--rollback]"
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --rollback) MODE=rollback ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

dc() { docker compose -f "$COMPOSE" "$@"; }
step() { CURRENT_STEP="$*"; printf '\n==> %s\n' "$*"; }
# Allt som ÄNDRAR något går genom run: med --dry-run skrivs det bara ut.
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

# ─── Läget, för rapporten om något avbryter ─────────────────────────────
CURRENT_STEP="start"
STATE_CODE="oförändrad ($(git rev-parse --short HEAD))"
STATE_CLIENT="oförändrad"
STATE_SERVER="oförändrad"
STATE_DB="oförändrad"

report() {
  local status=$?
  [ "$status" -ne 0 ] || return 0
  {
    printf '\n!! deploy AVBRÖTS i steget: %s (exit %s)\n' "$CURRENT_STEP" "$status"
    printf '   kod (git): %s\n' "$STATE_CODE"
    printf '   klient:    %s — %s\n' "$STATE_CLIENT" "$(release_describe)"
    printf '   server:    %s\n' "$STATE_SERVER"
    printf '   databas:   %s\n' "$STATE_DB"
    printf '   Rätta felet och kör om: bash tooling/scripts/deploy-prod.sh\n'
  } >&2
}
trap report EXIT

# ─── Rollback: bara klienten (servern: se docs/deploy-server-first.md) ──
if [ "$MODE" = rollback ]; then
  step "rollback av klienten till releases/previous"
  release_describe
  run release_rollback
  release_describe
  echo "Servern och databasen rördes inte. Migrationer går bara framåt — se"
  echo "docs/deploy-server-first.md (Rollback) om servern också ska tillbaka."
  exit 0
fi

wait_ready() {
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] väntar på /readyz"; return 0; fi
  for _ in $(seq 1 "$READY_TRIES"); do
    if dc exec -T caddy wget -q -O- http://server-first:3001/readyz 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep "$READY_PAUSE"
  done
  return 1
}

# Caddyfile är en enskild fil i en bind-mount: git ersätter filen (ny inode),
# så en ändring syns i containern först efter omstart. Ingen ändring → ingen
# omstart (och inget avbrott för de som är inne).
caddyfile_stale() {
  ! dc exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | cmp -s - "$CADDYFILE"
}

step "kontrollerar att inget annat bygge kör"
if [ -n "$(docker ps -q --filter ancestor=oven/bun:1)" ]; then
  echo "ett annat bygge (oven/bun) kör redan — avbryter" >&2
  exit 1
fi

step "uppdaterar till origin/main (bara fast-forward)"
before="${AVA_DEPLOY_BEFORE:-$(git rev-parse --short HEAD)}"
# fetch ändrar bara origin/*, inget som körs — görs även vid --dry-run.
git fetch -q origin
run git merge --ff-only -q origin/main
if [ "$DRY_RUN" = 1 ]; then
  sha="$(git rev-parse --short origin/main)"
  git log --oneline "HEAD..origin/main"
  echo "(--dry-run visar DET HÄR skriptets steg; en ny version i origin/main kan ha andra)"
else
  sha="$(git rev-parse --short HEAD)"
  STATE_CODE="uppdaterad $before → $sha (påverkar inget som körs förrän servern startas om)"
  # Kör alltid deployen med skriptet ur den version som deployas: har det
  # ändrats startar vi om det (bash läser annars vidare i den gamla filen).
  # Bara en gång: i den omstartade körningen är AVA_DEPLOY_BEFORE satt.
  if [ -z "${AVA_DEPLOY_BEFORE:-}" ] &&
    ! git diff --quiet "$before" HEAD -- tooling/scripts/deploy-prod.sh tooling/scripts/lib/release.sh; then
    echo "deploy-skriptet har ändrats — startar om med den nya versionen"
    trap - EXIT
    AVA_DEPLOY_BEFORE="$before" exec bash tooling/scripts/deploy-prod.sh "$@"
  fi
fi
git log --oneline -1 "$sha"

step "läser ava-server.env"
[ -f ava-server.env ] || { echo "ava-server.env saknas i $PWD" >&2; exit 1; }
# shellcheck disable=SC1091 # finns bara på servern (hemligheter)
set -a && . ./ava-server.env && set +a

step "backup"
if systemctl cat ava-backup.service >/dev/null 2>&1; then
  run systemctl start ava-backup.service
  echo "backup: $(systemctl show -p Result --value ava-backup.service)"
else
  run bash tooling/scripts/backup-db.sh backup
fi

if [ -z "$(release_current)" ] && [ -d out ]; then
  step "första deployen med releases/: nuvarande out/ blir en release och Caddy flyttas dit"
  boot="$(release_new_name "$before")"
  run mkdir -p "$RELEASES_DIR"
  run cp -a out "$RELEASES_DIR/$boot"
  run release_activate "$boot"
  run dc up -d --no-deps caddy
  STATE_CLIENT="samma klient som före deployen, nu från releases/"
fi

step "tömmer Next byggcache (.next/cache) och byggrester (out/)"
run rm -rf .next/cache out

step "bygger server + klient (oven/bun) till out/ — Caddy serverar releases/current, inte out/"
run docker run --rm -v "$PWD:/app" -w /app -e DEMO_BASE_PATH= oven/bun:1 sh -c \
  'bun install --frozen-lockfile >/dev/null && bun run server-first:build >/dev/null && bash tooling/scripts/build-demo.sh >/tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }'

step "kontrollerar byggd CSS mot globals.css"
run bash tooling/scripts/check-built-css.sh src/app/globals.css out/_next/static/chunks/*.css

release="$(release_new_name "$sha")"
step "lägger bygget i releases/$release (inte aktivt än)"
run release_stage out "$release"
STATE_CLIENT="oförändrad; ny release releases/$release förberedd men inte aktiv"

step "kör databasmigrationer (db-migrate kör bara filer som saknas i schema_migrations)"
STATE_DB="migreringen avbröts — körda filer står i schema_migrations (varje fil i egen transaktion)"
run docker run --rm --network ava_default -v "$PWD:/app" -w /app \
  -e AVA_DATABASE_URL="postgres://${POSTGRES_USER:-ava}:$POSTGRES_PASSWORD@postgres:5432/${POSTGRES_DB:-ava}" \
  oven/bun:1 bun tooling/scripts/db-migrate.ts
STATE_DB="migrerad ($sha)"

step "startar om servern med ny kod (klienten är fortfarande den gamla)"
STATE_SERVER="omstarten avbröts — kontrollera: docker compose -f $COMPOSE ps"
run dc up -d --build

step "väntar på /readyz"
if ! wait_ready; then
  STATE_SERVER="omstartad med ny kod ($sha) men /readyz svarar inte ok efter $((READY_TRIES * READY_PAUSE)) s — se: docker compose -f $COMPOSE logs server-first"
  exit 1
fi
STATE_SERVER="omstartad med ny kod ($sha), /readyz ok"

step "byter klient atomärt: releases/current -> $release"
run release_activate "$release"
STATE_CLIENT="bytt till releases/$release"
if [ "$DRY_RUN" = 1 ] || caddyfile_stale; then
  run dc restart caddy
fi

step "städar gamla releaser (behåller current och previous)"
run release_prune

[ "$DRY_RUN" = 1 ] || dc ps --format '{{.Service}} {{.Status}}'
release_describe
echo "deploy klar: $(git log --oneline -1 "$sha")"
echo "förra klienten tillbaka: bash tooling/scripts/deploy-prod.sh --rollback"
