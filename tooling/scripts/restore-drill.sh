#!/usr/bin/env bash
#
# ÅTERSTÄLLNINGSÖVNING (#1079) — bevisar att backupen går att lita på.
#
#   bash tooling/scripts/restore-drill.sh
#
# En backup som aldrig återställts är en förhoppning, inte en backup. Den här
# övningen kör hela vägen mot produktions-compose:n:
#
#   1. starta stacken (postgres + server-first, persistent volym)
#   2. skapa ett ärende via det RIKTIGA API:t
#   3. ta backup
#   4. FÖRSTÖR datan — släpp tabellinnehållet
#   5. bekräfta att ärendet är borta (annars bevisar steg 6 ingenting)
#   6. återställ ur backupen
#   7. bekräfta att ärendet är tillbaka, och att tjänsten är frisk
#
# Steg 5 är det som gör övningen ärlig. Utan det skulle en återställning som
# inte gjorde någonting alls se ut att lyckas.
#
# Körs i CI vid varje ändring av backup-skripten eller compose:n, så rutinen
# inte hinner ruttna mellan gångerna någon behöver den.
set -euo pipefail

# Produktionsfilen + drill-overlayen (som exponerar portarna övningen behöver).
COMPOSE="tooling/docker/docker-compose.production.yml"
COMPOSE_ARGS=(-f "$COMPOSE" -f "tooling/docker/docker-compose.drill.yml")
WORK="${TMPDIR:-/tmp}/ava-restore-drill"
# backup-/restore-skripten tar EN compose-fil; de rör bara postgres och
# server-first, så produktionsfilen räcker för dem.
export AVA_COMPOSE="$COMPOSE"

# Produktions-compose:n kräver riktiga värden för TLS/OIDC. Övningen startar
# BARA postgres + server-first, men compose parsar hela filen → dummies.
export AVA_DOMAIN="drill.invalid"
export OIDC_ISSUER_URL="https://idp.invalid"
export OAUTH2_PROXY_CLIENT_ID="drill"
export OAUTH2_PROXY_CLIENT_SECRET="drill"
export OAUTH2_PROXY_COOKIE_SECRET="0123456789abcdef0123456789abcdef"
export POSTGRES_PASSWORD="drill-pw"
export POSTGRES_USER="ava"
export POSTGRES_DB="ava"
export AVA_ORGANIZATION_ID="00000000-0000-0000-0000-000000000001"

cleanup() { docker compose "${COMPOSE_ARGS[@]}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK"

echo "▸ Bygger server-first-binären …"
bun run server-first:build >/dev/null

echo "▸ Startar postgres + server-first (persistent volym) …"
docker compose "${COMPOSE_ARGS[@]}" up -d --build --wait --wait-timeout 180 postgres server-first

echo "▸ Migrerar schemat …"
docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1" >/dev/null
# Migrationerna körs från värden mot den exponerade porten i CI-overlayen.
AVA_DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5433/$POSTGRES_DB" \
  bun run db:migrate >/dev/null

echo "▸ Skapar ett ärende via API:t …"
SERVER_URL=http://localhost:3001 \
AVA_DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5433/$POSTGRES_DB" \
AVA_ORGANIZATION_ID="$AVA_ORGANIZATION_ID" \
  bun tooling/scripts/restore-drill-seed.ts > "$WORK/marker.txt"
MARKER="$(cat "$WORK/marker.txt")"
echo "  Markör: $MARKER"

echo "▸ Tar backup …"
bash tooling/scripts/backup-db.sh "$WORK"
DUMP="$(ls -1 "$WORK"/ava-*.sql.gz | head -1)"

echo "▸ FÖRSTÖR datan — släpper ärendetabellen …"
docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TRUNCATE matters CASCADE" >/dev/null

echo "▸ Bekräftar att ärendet ÄR borta (annars bevisar återställningen inget) …"
GONE=$(docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM matters WHERE matter_number = '$MARKER'")
if [ "$GONE" != "0" ]; then
  echo "✗ Ärendet finns kvar efter TRUNCATE ($GONE) — övningen är meningslös." >&2
  exit 1
fi
echo "  ✓ Borta"

echo "▸ Återställer ur backupen …"
AVA_RESTORE_YES=1 bash tooling/scripts/restore-db.sh "$DUMP"

echo "▸ Bekräftar att ärendet är TILLBAKA …"
BACK=$(docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM matters WHERE matter_number = '$MARKER'")
if [ "$BACK" != "1" ]; then
  echo "✗ Ärendet kom inte tillbaka (count=$BACK) — backupen går INTE att lita på." >&2
  exit 1
fi

echo
echo "✓ Återställningsövning klar: ärendet $MARKER förstördes och återskapades,"
echo "  och tjänsten är frisk efteråt (/readyz svarade ok)."
