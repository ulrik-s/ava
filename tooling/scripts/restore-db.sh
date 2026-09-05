#!/usr/bin/env bash
#
# Återställning av AVA:s Postgres (#1079).
#
#   bash tooling/scripts/restore-db.sh /srv/ava/backup/ava-2026-09-05-1400.sql.gz
#
# ## Detta ÖVERSKRIVER databasen
#
# Dumpen tas med `--clean --if-exists`, alltså släpper den befintliga objekt
# innan den lägger tillbaka sina egna. Kör den mot fel databas och byråns
# akter är borta. Därför kräver scriptet en uttrycklig bekräftelse — sätt
# `AVA_RESTORE_YES=1` för att köra obevakat (t.ex. i en övning).
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
  echo "Detta ÖVERSKRIVER databasen '$PG_DB'. Allt nuvarande innehåll försvinner."
  read -r -p "Skriv ÅTERSTÄLL för att fortsätta: " answer
  [ "$answer" = "ÅTERSTÄLL" ] || { echo "Avbrutet."; exit 1; }
fi

echo "▸ Stoppar server-first (ingen ska skriva under återställningen) …"
docker compose -f "$COMPOSE" stop server-first >/dev/null

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
