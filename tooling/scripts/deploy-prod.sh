#!/usr/bin/env bash
#
# DEPLOY på produktionsservern (#1166, #1369) — ett kommando i stället för ett
# recept man skriver för hand (och glömmer steg i).
#
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh             # deploy
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh --dry-run   # visa stegen, ändra inget
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh --rollback  # förra klienten tillbaka
#   cd /srv/ava && bash tooling/scripts/deploy-prod.sh --tag v1.2.0  # en tagg i stället för main
#
# Utan hand: ava-deploy.timer kör deploy-latest-tag.sh var femte minut, som
# kör det här med --tag när en ny v*-tagg finns i origin (Deploy via tagg i
# docs/deploy-server-first.md).
#
# Steg:
#   1. vägra om ett annat bygge redan kör
#   2. uppdatera till origin/main (bara fast-forward) eller till taggen
#      (--tag); har deploy-skriptet ändrats startas det om i den nya versionen
#   3. läs ava-server.env
#   4. backup (systemd-tjänsten ava-backup, annars backup-db.sh)
#   4b. backup på begäran (#1431): installera/uppdatera hostens
#      ava-backup-request.path/.service (bara om ava-backup.service finns)
#   4c. deploy via tagg: installera/uppdatera ava-deploy.timer/.service
#   5. (en gång) flytta Caddy från out/ till releases/current
#   6. TÖM .next/cache — en gammal byggcache gav en gång gammal CSS i prod
#   7. bygg server + klient i oven/bun (hosten har bara docker + git) till
#      out/, som INTE serveras. Klienten byggs UTAN demodata
#      (AVA_BUILD_TARGET=server, #1352) — skalet är publikt
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
SYSTEMD_DIR="${AVA_SYSTEMD_DIR:-/etc/systemd/system}"
BACKUP_UNITS="ava-backup-request.path ava-backup-request.service"
DEPLOY_UNITS="ava-deploy.timer ava-deploy.service"
CADDYFILE="tooling/docker/caddy/Caddyfile"
READY_TRIES="${AVA_DEPLOY_READY_TRIES:-30}"
READY_PAUSE="${AVA_DEPLOY_READY_PAUSE:-2}"
DRY_RUN=0
MODE=deploy
TAG=""

usage() {
  echo "användning: bash tooling/scripts/deploy-prod.sh [--dry-run] [--rollback] [--tag <v…>]"
}

# Originalargumenten: skriptet startar om sig självt med dem om det ändrats.
ARGS=("$@")
while [ $# -gt 0 ]; do
  arg="$1"; shift
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --rollback) MODE=rollback ;;
    --tag) TAG="${1:-}"; [ -n "$TAG" ] || { usage >&2; exit 2; }; shift ;;
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

# Enhetsfiler ur repot till systemd — bara de som ändrats, och daemon-reload
# bara då. `enable --now` är idempotent. install_units "<enheter>" <enable>
install_units() {
  local unit changed=0
  for unit in $1; do
    if ! cmp -s "tooling/systemd/$unit" "$SYSTEMD_DIR/$unit"; then
      run install -m 644 "tooling/systemd/$unit" "$SYSTEMD_DIR/$unit"
      changed=1
    fi
  done
  [ "$changed" = 0 ] || run systemctl daemon-reload
  run systemctl enable --now "$2"
}

step "kontrollerar att inget annat bygge kör"
if [ -n "$(docker ps -q --filter ancestor=oven/bun:1)" ]; then
  echo "ett annat bygge (oven/bun) kör redan — avbryter" >&2
  exit 1
fi

target="${TAG:-origin/main}"
step "uppdaterar till $target${TAG:+ (taggen)}${TAG:- (bara fast-forward)}"
before="${AVA_DEPLOY_BEFORE:-$(git rev-parse --short HEAD)}"
# fetch ändrar bara origin/* och taggarna, inget som körs — görs även vid --dry-run.
git fetch -q origin --tags
if [ -n "$TAG" ]; then
  git rev-parse --verify --quiet "$TAG^{commit}" >/dev/null || { echo "taggen $TAG finns inte i origin" >&2; exit 1; }
  run git checkout -q --detach "$TAG"
else
  run git merge --ff-only -q origin/main
fi
if [ "$DRY_RUN" = 1 ]; then
  sha="$(git rev-parse --short "$target")"
  git log --oneline "HEAD..$target"
  echo "(--dry-run visar DET HÄR skriptets steg; en ny version i $target kan ha andra)"
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
    AVA_DEPLOY_BEFORE="$before" exec bash tooling/scripts/deploy-prod.sh "${ARGS[@]}"
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

step "backup på begäran: hostens .path-enhet (#1431)"
if systemctl cat ava-backup.service >/dev/null 2>&1; then
  install_units "$BACKUP_UNITS" ava-backup-request.path
else
  echo "ingen ava-backup.service — \"Ta backup nu\" fungerar först när nattjobbet finns (docs/deploy-server-first.md, Backup)"
fi

step "deploy via tagg: hostens timer (ava-deploy.timer)"
install_units "$DEPLOY_UNITS" ava-deploy.timer

if [ -z "$(release_current)" ] && [ -d out ]; then
  step "första deployen med releases/: nuvarande out/ blir en release och Caddy flyttas dit"
  # Vilken version en gammal out/ byggdes från går inte att veta (efter en
  # manuell ff-merge är HEAD redan den NYA) → ett ärligt namn, ingen sha.
  boot="$(release_new_name bootstrap)"
  run mkdir -p "$RELEASES_DIR"
  run cp -a out "$RELEASES_DIR/$boot"
  run release_activate "$boot"
  run dc up -d --no-deps caddy
  STATE_CLIENT="samma klient som före deployen, nu från releases/"
fi

step "tömmer Next byggcache (.next/cache) och byggrester (out/)"
run rm -rf .next/cache out

step "bygger server + klient (oven/bun) till out/ — Caddy serverar releases/current, inte out/"
run docker run --rm -v "$PWD:/app" -w /app -e DEMO_BASE_PATH= -e AVA_BUILD_TARGET=server oven/bun:1 sh -c \
  'bun install --frozen-lockfile >/dev/null && bun run server-first:build >/dev/null && bash tooling/scripts/build-demo.sh >/tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }'

step "kontrollerar byggd CSS mot globals.css"
run bash tooling/scripts/check-built-css.sh src/app/globals.css out/_next/static/chunks/*.css

release="$(release_new_name "$sha")"
step "lägger bygget i releases/$release (inte aktivt än)"
run release_stage out "$release"
STATE_CLIENT="oförändrad; ny release releases/$release förberedd men inte aktiv"

step "kör databasmigrationer (db-migrate kör bara filer som saknas i schema_migrations)"
STATE_DB="migreringen avbröts — körda filer står i schema_migrations (varje fil i egen transaktion)"
# Lösenordet ALDRIG på kommandoraden: den syns i `ps` och i --dry-run-utskriften.
# URL:en ligger i skriptets miljö; `-e NAMN` utan värde låter docker läsa den därifrån.
export AVA_DATABASE_URL="postgres://${POSTGRES_USER:-ava}:$POSTGRES_PASSWORD@postgres:5432/${POSTGRES_DB:-ava}"
run docker run --rm --network ava_default -v "$PWD:/app" -w /app \
  -e AVA_DATABASE_URL \
  oven/bun:1 bun tooling/scripts/db-migrate.ts
STATE_DB="migrerad ($sha)"

step "startar om servern med ny kod (klienten är fortfarande den gamla)"
STATE_SERVER="omstarten avbröts — kontrollera: docker compose -f $COMPOSE ps"
# Versionsstämpeln i /readyz (och PostHog): taggen om HEAD är taggad, annars
# sha. ava-server.env får sätta egen. ponytail: wait_ready kräver inte att
# stämpeln bytt — lägg till det om en gammal server någon gång svarar ok.
export AVA_RELEASE="${AVA_RELEASE:-$(git describe --tags --always)}"
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
