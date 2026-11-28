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
#   2. skapa ett ärende med ett dokument via det RIKTIGA API:t
#   3. gör en krypterad full export (backup-export.sh) och provåterställ den i
#      en engångs-Postgres (backup-verify.sh): hela offsite-kedjan, inklusive
#      dokumenten (#1254)
#   4. skapa ett ANDRA ärende med ett nytt dokument, gör en timexport
#      (`backup-export.sh --hourly`, ADR 0039) och provåterställ den med sin
#      bas (#1897)
#   5. FÖRSTÖR datan — släpp tabellinnehållet och töm dokumentvolymen
#   6. bekräfta att båda ärendena OCH dokumentfilerna är borta (annars bevisar
#      steg 7 ingenting)
#   7. återställ med runbookens kommandon (docs/runbook-aterstallning.md):
#      databasen ur timexportens dump, dokumenten ur basens arkiv och SEDAN
#      timexportens tillägg
#   8. bekräfta att båda ärendena och dokumenten är tillbaka, och att tjänsten
#      är frisk
#   9. bekräfta att synkepoken bytts (#1360): change_log har gått tillbaka till
#      backupens läge, och klienterna ska synka om från 0 i stället för att
#      tyst missa ändringar efter sina gamla cursorer
#
# Steg 6 är det som gör övningen ärlig. Utan det skulle en återställning som
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

# Ett markörärende med ett uppladdat dokument via API:t; ärendenumret på stdout.
seed_marker() {
  SERVER_URL=http://localhost:3001 \
  AVA_DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5433/$POSTGRES_DB" \
  AVA_ORGANIZATION_ID="$AVA_ORGANIZATION_ID" \
    bun tooling/scripts/restore-drill-seed.ts
}

psql_value() {
  docker compose "${COMPOSE_ARGS[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"
}

fail() { echo "✗ $*" >&2; exit 1; }

echo "▸ Skapar ett ärende via API:t …"
MARKER="$(seed_marker)"
echo "  Markör: $MARKER"

EPOCH_BEFORE=$(psql_value "SELECT epoch FROM sync_epoch")
[ -n "$EPOCH_BEFORE" ] || fail "ingen synkepok före backupen (migration 0041?)."

echo "▸ Offsite-kedjan (#1254): krypterad export → provåterställning i engångs-Postgres …"
# Den kedja som används vid en katastrof (backup-export → age → hämtning →
# dekryptering → återställning) övas här. backup-export kör backup-db.sh för
# dumpen. En engångsnyckel: bara den publika hamnar hos backup-export, precis
# som på servern.
docker run --rm -v "$WORK":/w alpine sh -c \
  'apk add -q --no-cache age >/dev/null && age-keygen -o /w/age.key 2>/dev/null && chmod 644 /w/age.key'
grep 'public key' "$WORK/age.key" | awk '{print $4}' > "$WORK/recipient.txt"
AVA_CONTENT_VOLUME=ava_content bash tooling/scripts/backup-export.sh "$WORK/recipient.txt" "$WORK/export"
EXPORT="$(ls -1 "$WORK"/export/ava-*.tar.age | head -1)"
bash tooling/scripts/backup-verify.sh "$EXPORT" "$WORK/age.key" --expect-matter "$MARKER"

echo "▸ Timexporten (ADR 0039, #1897): ett andra ärende och dokument efter den fulla exporten …"
MARKER2="$(seed_marker)"
echo "  Markör: $MARKER2"
AVA_CONTENT_VOLUME=ava_content bash tooling/scripts/backup-export.sh "$WORK/recipient.txt" "$WORK/export" --hourly
HOURLY="$(ls -1 "$WORK"/export/ava-*-hourly.tar.age 2>/dev/null | head -1)"
[ -n "$HOURLY" ] || fail "ingen timexport skapades — backup-export.sh --hourly gjorde en full export i stället."
bash tooling/scripts/backup-verify.sh "$HOURLY" "$WORK/age.key" --expect-matter "$MARKER2"

# Markördokumentets fil i dokumentvolymen (för steget "dokumenten tillbaka").
doc_path_of() {
  local path
  path=$(psql_value "SELECT storage_path FROM documents WHERE file_name = '$1.txt'")
  [ -n "$path" ] || fail "markördokumentet för $1 saknas — övningen är meningslös."
  echo "$path"
}
DOC_PATH="$(doc_path_of "$MARKER")"
DOC_PATH2="$(doc_path_of "$MARKER2")"
doc_on_disk() { docker run --rm -v ava_content:/content:ro alpine test -f "/content/$1"; }
matter_count() { psql_value "SELECT count(*) FROM matters WHERE matter_number = '$1'"; }

echo "▸ FÖRSTÖR datan — släpper ärendetabellen och tömmer dokumentvolymen …"
docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TRUNCATE matters CASCADE" >/dev/null
docker run --rm -v ava_content:/content alpine sh -c 'rm -rf /content/documents'
for p in "$DOC_PATH" "$DOC_PATH2"; do
  if doc_on_disk "$p"; then fail "dokumentet $p finns kvar efter att volymen tömts — övningen är meningslös."; fi
done

echo "▸ Bekräftar att ärendena ÄR borta (annars bevisar återställningen inget) …"
for m in "$MARKER" "$MARKER2"; do
  GONE="$(matter_count "$m")"
  [ "$GONE" = "0" ] || fail "ärendet $m finns kvar efter TRUNCATE ($GONE) — övningen är meningslös."
done
echo "  ✓ Borta"

echo "▸ Packar upp timexporten och dess bas (runbook-aterstallning.md, steg 2) …"
R="$WORK/restore"
mkdir -p "$R/bas" && cp "$HOURLY" "$WORK/age.key" "$R/" && cp "$EXPORT" "$R/bas/"
docker run --rm -v "$R":/w alpine sh -c \
  "apk add -q --no-cache age && age -d -i /w/age.key /w/$(basename "$HOURLY") | tar -C /w -xf - \
   && age -d -i /w/age.key /w/bas/$(basename "$EXPORT") | tar -C /w/bas -xf -" >/dev/null
(cd "$R" && sha256sum -c SHA256SUMS >/dev/null)
(cd "$R/bas" && sha256sum -c SHA256SUMS >/dev/null)
[ "$(cat "$R/BASE")" = "$(basename "$EXPORT")" ] || fail "timexportens BASE pekar inte på den fulla exporten."

echo "▸ Återställer databasen ur timexportens dump (steg 3) …"
AVA_RESTORE_YES=1 bash tooling/scripts/restore-db.sh "$(ls -1 "$R"/ava-*.sql.gz | head -1)"

echo "▸ Återställer dokumenten: basen först, sedan tillägget (steg 4) …"
docker compose "${COMPOSE_ARGS[@]}" stop server-first >/dev/null
docker run --rm -v ava_content:/content -v "$R":/r:ro alpine \
  sh -c 'tar -C /content -xzf /r/bas/content.tar.gz && tar -C /content -xzf /r/content-diff.tar.gz'
docker compose "${COMPOSE_ARGS[@]}" up -d --wait --wait-timeout 120 server-first >/dev/null
for p in "$DOC_PATH" "$DOC_PATH2"; do
  doc_on_disk "$p" || fail "dokumentet kom inte tillbaka ($p) — dokumentbackupen går INTE att lita på."
done
echo "  ✓ Dokumenten är tillbaka"

echo "▸ Bekräftar att ärendena är TILLBAKA …"
for m in "$MARKER" "$MARKER2"; do
  BACK="$(matter_count "$m")"
  [ "$BACK" = "1" ] || fail "ärendet $m kom inte tillbaka (count=$BACK) — backupen går INTE att lita på."
done
echo "  ✓ Ärendena är tillbaka"

echo "▸ Bekräftar att synkepoken bytts (klienterna synkar om från 0, #1360) …"
EPOCH_AFTER=$(psql_value "SELECT epoch FROM sync_epoch")
if [ -z "$EPOCH_AFTER" ] || [ "$EPOCH_AFTER" = "$EPOCH_BEFORE" ]; then
  echo "✗ Synkepoken bytte inte ($EPOCH_BEFORE → ${EPOCH_AFTER:-ingen}) — klienter före den återställda servern skulle missa ändringar." >&2
  exit 1
fi
echo "  ✓ $EPOCH_BEFORE → $EPOCH_AFTER"

echo
echo "✓ Återställningsövning klar: ärendena $MARKER och $MARKER2 och deras dokument"
echo "  förstördes och återskapades ur timexporten och dess bas — databasen ur"
echo "  timexportens dump, dokumenten ur basens arkiv och tillägget — och tjänsten"
echo "  är frisk efteråt (/readyz svarade ok). Synkepoken byttes, så klienterna"
echo "  synkar om från 0."
