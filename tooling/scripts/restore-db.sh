#!/usr/bin/env bash
#
# Återställning av AVA:s Postgres (#1079).
#
#   bash tooling/scripts/restore-db.sh /srv/ava/backup/ava-2026-09-05-1400.sql.gz
#
# ## Detta RADERAR OCH ÅTERSKAPAR databasen
#
# Databasen droppas och skapas om innan dumpen läses in. Kör den mot fel
# databas och byråns akter är borta. Därför kräver scriptet en uttrycklig
# bekräftelse — sätt `AVA_RESTORE_YES=1` för att köra obevakat (t.ex. i en
# övning).
#
# Varför drop-and-create och inte `pg_dump --clean`: pg-boss partitionerar
# sina jobbtabeller, och de DROP-satser `--clean` genererar fallerar på ärvda
# constraints ("cannot drop inherited constraint job_common_pkey"). En tom
# databas har inget att droppa och problemet uppstår aldrig.
#
# ## Ordningen spelar roll
#
# server-first stoppas FÖRE återställningen och startas efter. Skriver
# applikationen medan dumpen läggs tillbaka blir resultatet en blandning av
# två tidpunkter — värre än både den gamla och den nya datan var för sig.
set -euo pipefail

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Användning: $0 <dump.sql.gz>" >&2
  exit 2
fi

COMPOSE="${AVA_COMPOSE:-tooling/docker/docker-compose.production.yml}"
PG_USER="${POSTGRES_USER:-ava}"
PG_DB="${POSTGRES_DB:-ava}"

# Kontrollera checksumman när den finns — en trasig dump ska upptäckas nu,
# inte halvvägs in i återställningen med en tömd databas.
if [ -f "$DUMP.sha256" ]; then
  echo "▸ Verifierar checksumma …"
  if command -v sha256sum >/dev/null; then sha256sum -c "$DUMP.sha256"; else shasum -a 256 -c "$DUMP.sha256"; fi
fi
gzip -t "$DUMP" || { echo "✗ Dumpen är trasig." >&2; exit 1; }

if [ "${AVA_RESTORE_YES:-}" != "1" ]; then
  echo
  echo "Detta RADERAR OCH ÅTERSKAPAR databasen '$PG_DB'. Allt nuvarande innehåll försvinner."
  read -r -p "Skriv ÅTERSTÄLL för att fortsätta: " answer
  [ "$answer" = "ÅTERSTÄLL" ] || { echo "Avbrutet."; exit 1; }
fi

echo "▸ Stoppar server-first (ingen ska skriva under återställningen) …"
docker compose -f "$COMPOSE" stop server-first >/dev/null

# Kvarvarande sessioner blockerar DROP DATABASE. server-first är stoppad, men
# poolen kan ha connections som ännu inte hunnit stängas.
echo "▸ Kopplar ner kvarvarande sessioner …"
docker compose -f "$COMPOSE" exec -T postgres psql -U "$PG_USER" -d postgres --quiet -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = '$PG_DB' AND pid <> pg_backend_pid()" >/dev/null

echo "▸ Återskapar databasen …"
docker compose -f "$COMPOSE" exec -T postgres psql -U "$PG_USER" -d postgres --quiet \
  -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$PG_DB\"" -c "CREATE DATABASE \"$PG_DB\"" >/dev/null

echo "▸ Lägger tillbaka dumpen …"
gunzip -c "$DUMP" | docker compose -f "$COMPOSE" exec -T postgres \
  psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 --quiet

echo "▸ Startar server-first …"
docker compose -f "$COMPOSE" start server-first >/dev/null

echo "▸ Väntar på att tjänsten ska bli frisk …"
for _ in $(seq 1 30); do
  if docker compose -f "$COMPOSE" exec -T server-first \
      wget -q -O- http://127.0.0.1:3001/readyz 2>/dev/null | grep -q '"status":"ok"'; then
    echo "✓ Återställd och frisk — /readyz svarar ok."
    exit 0
  fi
  sleep 2
done

echo "✗ Tjänsten blev inte frisk inom 60 s. Kolla: docker compose -f $COMPOSE logs server-first" >&2
exit 1
