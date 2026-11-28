#!/usr/bin/env bash
#
# Provåterställ en krypterad backup — utan att röra produktionen (#1254).
#
#   bash tooling/scripts/backup-verify.sh ~/AVA-backup/ava-2026-09-29-0300.tar.age ~/.config/ava-backup/age.key
#   bash tooling/scripts/backup-verify.sh <arkiv> <nyckel> --expect-matter DRILL-abc123
#   bash tooling/scripts/backup-verify.sh ~/AVA-backup/ava-2026-09-29-1415-hourly.tar.age ~/.config/ava-backup/age.key
#
# Det backup-pull.sh gör varje natt (checksumma + provdekryptering) bevisar att
# filen går att öppna. Det här bevisar att den går att ÅTERSTÄLLA:
#
#   1. dekryptera med den privata nyckeln och packa upp,
#   2. kontrollera checksummorna i arkivet (SHA256SUMS),
#   3. läs in databasdumpen i en ENGÅNGS-Postgres (docker, raderas efteråt),
#   4. kontrollera att det som kom tillbaka är rimligt: användare finns,
#      migrationerna finns, och VARJE dokument som databasen pekar på finns i
#      dokumentarkivet — en databas som pekar på filer som saknas är ingen
#      återställning.
#
# En timexport (`ava-<stämpel>-hourly.tar.age`, ADR 0039) går inte att
# återställa ensam: databasen finns i dess dump, men dokumenten i basens fulla
# arkiv plus timexportens tillägg. Basen (timexportens `BASE`) ska ligga i samma
# katalog. Båda arkivens checksummor kontrolleras, databasen läses ur
# timexportens dump, och dokumentkontrollen görs mot basens `content.tar.gz` och
# tilläggets `content-diff.tar.gz` tillsammans. Basens namn skrivs ut: det är
# de två filerna som ska till servern (runbook-aterstallning.md, steg 0).
#
# Kör den regelbundet på datorn som hämtar backuperna (launchd/cron, t.ex.
# varje söndag) — det är den "övade återställningen mot en riktig prod-dump"
# som #1254 efterfrågar, utan att produktionen någonsin berörs.
#
# AVA_VERIFY_MISSING_OK=1: dokument som saknar innehåll ger en varning i
# stället för ett fel (se kontrollen nedan).
#
# Kräver: docker, tar, sha256sum/shasum. age används om det finns, annars i en
# engångs-container (samma som backup-export.sh).
set -euo pipefail
# shellcheck source=lib/pg-ready.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/pg-ready.sh"

ARCHIVE="${1:-}"
KEY="${2:-}"
EXPECT_MATTER=""
if [ "${3:-}" = "--expect-matter" ]; then EXPECT_MATTER="${4:-}"; fi
PG_IMAGE="${AVA_VERIFY_PG_IMAGE:-postgres:16-alpine}"

usage() { echo "Användning: $0 <arkiv.tar.age> <age-nyckel> [--expect-matter <ärendenummer>]" >&2; exit 2; }
fail() { echo "✗ $*" >&2; exit 1; }

[ -n "$ARCHIVE" ] && [ -n "$KEY" ] || usage
[ -f "$ARCHIVE" ] || fail "arkivet finns inte: $ARCHIVE"
[ -f "$KEY" ] || fail "nyckeln finns inte: $KEY"
if [ "${3:-}" = "--expect-matter" ] && [ -z "$EXPECT_MATTER" ]; then usage; fi

WORK="$(mktemp -d)"
CONTAINER="ava-backup-verify-$$"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

sha256_check() { if command -v sha256sum >/dev/null; then sha256sum -c "$@"; else shasum -a 256 -c "$@"; fi; }

# De fulla exporternas namnform (backup-export.sh): bara en sådan kan vara bas.
FULL_EXPORT_NAME='^ava-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\.tar\.age$'

decrypt() {
  if command -v age >/dev/null; then
    age -d -i "$KEY" "$1"
  else
    docker run --rm -i -v "$(cd "$(dirname "$KEY")" && pwd)/$(basename "$KEY")":/key:ro alpine \
      sh -c 'apk add -q --no-cache age >/dev/null && age -d -i /key' < "$1"
  fi
}

# Dekryptera arkivet $1 till katalogen $2 och kontrollera dess checksummor.
unpack() {
  local name
  name="$(basename "$1")"
  mkdir -p "$2"
  decrypt "$1" | tar -C "$2" -xf - 2>/dev/null || fail "$name går inte att dekryptera/packa upp med den här nyckeln"
  [ -f "$2/SHA256SUMS" ] || fail "$name saknar SHA256SUMS"
  (cd "$2" && sha256_check SHA256SUMS >/dev/null 2>&1) || fail "checksummorna i $name stämmer inte"
}

# Timexportens bas: namnet ur `BASE`, validerat, och filen bredvid timexporten.
# Båda felen kommer innan basen öppnas och innan någon container startar.
base_of_hourly() {
  local base dir
  base="$(head -n 1 "$WORK/BASE" 2>/dev/null || true)"
  [[ "$base" =~ $FULL_EXPORT_NAME ]] || fail "timexportens BASE är inte en full export (ava-ÅÅÅÅ-MM-DD-TTMM.tar.age): '$base'"
  dir="$(cd "$(dirname "$ARCHIVE")" && pwd)"
  [ -f "$dir/$base" ] || fail "basen $base saknas bredvid timexporten (i $dir) — hämta den dit och försök igen"
  echo "$dir/$base"
}

echo "▸ Dekrypterar och packar upp …"
unpack "$ARCHIVE" "$WORK"
DUMP="$(ls -1 "$WORK"/ava-*.sql.gz 2>/dev/null | head -1)"
[ -n "$DUMP" ] || fail "arkivet saknar databasdump (ava-*.sql.gz)"
# Dokumenten: hela volymen i en full export; i en timexport basens arkiv plus tillägget.
BASE=""
case "$(basename "$ARCHIVE")" in
  ava-*-hourly.tar.age)
    [ -f "$WORK/content-diff.tar.gz" ] || fail "timexporten saknar dokumenttillägget (content-diff.tar.gz)"
    BASE_PATH="$(base_of_hourly)"
    BASE="$(basename "$BASE_PATH")"
    echo "  Basen: $BASE"
    unpack "$BASE_PATH" "$WORK/base"
    [ -f "$WORK/base/content.tar.gz" ] || fail "basen $BASE saknar dokumenten (content.tar.gz)"
    CONTENT_ARCHIVES=("$WORK/base/content.tar.gz" "$WORK/content-diff.tar.gz")
    ;;
  *)
    [ -f "$WORK/content.tar.gz" ] || fail "arkivet saknar dokumenten (content.tar.gz)"
    CONTENT_ARCHIVES=("$WORK/content.tar.gz")
    ;;
esac
echo "  ✓ checksummor ok"

echo "▸ Läser in dumpen i en engångs-Postgres ($PG_IMAGE) …"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=verify -e POSTGRES_USER=ava -e POSTGRES_DB=ava "$PG_IMAGE" >/dev/null
# Väntan (init klar + pg_isready) och varför den ser ut som den gör: lib/pg-ready.sh.
wait_for_pg "$CONTAINER" 90 || fail "engångs-Postgres startade inte"
gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U ava -d ava >/dev/null \
  || fail "dumpen gick inte att läsa in"

sql() { docker exec "$CONTAINER" psql -U ava -d ava -tAc "$1"; }

# Användarna (byråns allowlist) finns i varje driftsatt server — en databas utan
# dem är tom eller fel. Byrån själv kan sakna rad (id:t kommer ur miljön).
USERS="$(sql "SELECT count(*) FROM users")"
[ "$USERS" -ge 1 ] || fail "inga användare i den återställda databasen"
MIGRATIONS="$(sql "SELECT count(*) FROM schema_migrations")"
[ "$MIGRATIONS" -ge 1 ] || fail "inga migrationer registrerade (schema_migrations är tom)"
MATTERS="$(sql "SELECT count(*) FROM matters")"
DOCS="$(sql "SELECT count(*) FROM documents WHERE deleted_at IS NULL")"
echo "  ✓ användare: $USERS · ärenden: $MATTERS · dokument: $DOCS · migrationer: $MIGRATIONS"

if [ -n "$EXPECT_MATTER" ]; then
  # Via stdin: psql interpolerar :'m' (säker citering) bara i skript, inte i -c.
  FOUND="$(echo "SELECT count(*) FROM matters WHERE matter_number = :'m';" \
    | docker exec -i "$CONTAINER" psql -U ava -d ava -tA -v m="$EXPECT_MATTER")"
  [ "$FOUND" = "1" ] || fail "ärendet $EXPECT_MATTER finns inte i backupen"
  echo "  ✓ ärendet $EXPECT_MATTER finns"
fi

echo "▸ Kontrollerar att varje dokument databasen pekar på finns i dokumentarkivet …"
for a in "${CONTENT_ARCHIVES[@]}"; do tar -tzf "$a"; done | sed -e 's#^\./##' | sort -u > "$WORK/content.list"
sql "SELECT DISTINCT storage_path FROM documents WHERE deleted_at IS NULL AND storage_path LIKE 'documents/content/%'" \
  | sort -u > "$WORK/referenced.list"
MISSING="$(comm -23 "$WORK/referenced.list" "$WORK/content.list" | wc -l | tr -d ' ')"
if [ "$MISSING" != "0" ]; then
  echo "  saknas (första 5):" >&2
  comm -23 "$WORK/referenced.list" "$WORK/content.list" | head -5 | sed 's/^/    /' >&2
  # T.ex. ett dokument vars bytes aldrig nådde servern (klienten var offline):
  # det går inte att återställa ur backupen. AVA_VERIFY_MISSING_OK=1 gör det
  # till en varning när det är känt och utrett.
  [ "${AVA_VERIFY_MISSING_OK:-}" = "1" ] || fail "$MISSING dokument pekar på innehåll som inte finns i backupen"
  echo "  ⚠ $MISSING dokument saknar innehåll (AVA_VERIFY_MISSING_OK=1)" >&2
else
  echo "  ✓ alla $(wc -l < "$WORK/referenced.list" | tr -d ' ') refererade dokumentfiler finns"
fi

echo
if [ -n "$BASE" ]; then
  echo "✓ Timexporten $(basename "$ARCHIVE") går att återställa, tillsammans med basen $BASE."
  echo "  Båda filerna ska till servern (runbook-aterstallning.md, steg 2)."
else
  echo "✓ Backupen $(basename "$ARCHIVE") går att återställa."
fi
