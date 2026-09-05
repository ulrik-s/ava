#!/usr/bin/env bash
#
# Backup av AVA:s Postgres (#1079).
#
# Byråns akter ligger i Postgres. Utan ett verifierat återställningsflöde är
# systemet inte driftsatt-bart för en advokatbyrå — akter måste kunna
# återskapas.
#
#   bash tooling/scripts/backup-db.sh /srv/ava/backup
#
# Skriver <out>/ava-<datum>.sql.gz och en checksumma bredvid.
#
# ## Varför pg_dump och inte en volym-tar
#
# En tar av `/var/lib/postgresql/data` på en KÖRANDE databas ger en
# inkonsistent kopia som ofta går att packa upp men inte att starta. pg_dump
# tar en transaktionskonsistent ögonblicksbild medan tjänsten är igång.
#
# ## Det här scriptet är halva jobbet
#
# Den andra halvan är `restore-db.sh`, och en backup som aldrig återställts är
# en förhoppning. Kör återställningsövningen minst en gång — se
# docs/deploy-server-first.md.
set -euo pipefail

OUT_DIR="${1:-}"
if [ -z "$OUT_DIR" ]; then
  echo "Användning: $0 <katalog-för-backuper>" >&2
  exit 2
fi

COMPOSE="${AVA_COMPOSE:-tooling/docker/docker-compose.production.yml}"
PG_USER="${POSTGRES_USER:-ava}"
PG_DB="${POSTGRES_DB:-ava}"
STAMP="$(date +%F-%H%M)"
FILE="$OUT_DIR/ava-$STAMP.sql.gz"

mkdir -p "$OUT_DIR"

echo "▸ Dumpar $PG_DB …"
# INGEN --clean. Den genererar DROP-satser som fallerar på ÄRVDA constraints:
# pg-boss partitionerar sina jobbtabeller, och `DROP CONSTRAINT job_common_pkey`
# ger "cannot drop inherited constraint". Upptäckt av återställningsövningen —
# med --clean var backupen oåterställbar, vilket inget annat hade avslöjat.
#
# I stället återskapar restore-db.sh databasen från grunden före återläsningen.
docker compose -f "$COMPOSE" exec -T postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" \
  | gzip -9 > "$FILE"

# Verifiera att dumpen inte är trunkerad. En tyst halv backup är värre än
# ingen: den ser ut att finnas ända tills man behöver den.
if ! gzip -t "$FILE" 2>/dev/null; then
  echo "✗ Dumpen är trasig (gzip -t) — tas bort så den inte förväxlas med en giltig backup." >&2
  rm -f "$FILE"
  exit 1
fi

SIZE=$(wc -c < "$FILE" | tr -d ' ')
if [ "$SIZE" -lt 1000 ]; then
  echo "✗ Dumpen är bara $SIZE byte — nästan säkert tom. Tas bort." >&2
  rm -f "$FILE"
  exit 1
fi

sha256sum "$FILE" > "$FILE.sha256" 2>/dev/null || shasum -a 256 "$FILE" > "$FILE.sha256"

echo "✓ $FILE ($((SIZE / 1024)) kB)"
echo "  Checksumma: $(cut -d' ' -f1 < "$FILE.sha256")"
echo
echo "  Kom ihåg: en backup som aldrig återställts är en förhoppning."
echo "  Kör återställningsövningen — bash tooling/scripts/restore-db.sh $FILE"
