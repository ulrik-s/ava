#!/usr/bin/env bash
#
# Hämtar AVA:s krypterade backuper till byråns egen dator (pull).
#
# Motsvarigheten till backup-export.sh på servern. Körs av launchd/cron på en
# dator på kontoret (eller en NAS): hämtar nya exporter över read-only SFTP,
# verifierar checksumman, provdekrypterar, och gallrar gamla.
#
#   AVA_BACKUP_HOST=avabackup@ava-crm.io \
#   AVA_BACKUP_KEY=~/.config/ava-backup/age.key \
#     bash tooling/scripts/backup-pull.sh ~/AVA-backup
#
# Kräver: ssh/sftp, age, shasum eller sha256sum. Inget på servern ändras —
# kontot där är read-only och chrootat.
#
# Larmar (exit 1 + macOS-notis) om senaste backupen är äldre än
# AVA_BACKUP_MAX_AGE_H timmar: en backup som tyst slutat komma är den farliga.
set -euo pipefail

DEST="${1:-}"
HOST="${AVA_BACKUP_HOST:?AVA_BACKUP_HOST krävs (t.ex. avabackup@ava-crm.io)}"
KEY="${AVA_BACKUP_KEY:?AVA_BACKUP_KEY krävs (age-identitetsfilen)}"
KEEP_DAYS="${AVA_BACKUP_KEEP_DAYS:-90}"
MAX_AGE_H="${AVA_BACKUP_MAX_AGE_H:-48}"
[ -n "$DEST" ] || { echo "Användning: $0 <lokal-katalog>" >&2; exit 2; }

fail() {
  echo "✗ $*" >&2
  command -v osascript >/dev/null && osascript -e "display notification \"$*\" with title \"AVA-backup misslyckades\"" || true
  exit 1
}

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

mkdir -p "$DEST"
cd "$DEST"

# Lista på servern, hämta det som saknas lokalt (filerna är oföränderliga).
remote=$(echo "ls -1" | sftp -q -b - "$HOST" | grep -E '^ava-.*\.tar\.age$' || true)
[ -n "$remote" ] || fail "inga exporter på $HOST"

batch=""
for f in $remote; do
  # -p: behåll serverns mtime → gallring och ålderslarm räknar från när
  # backupen TOGS, inte när den hämtades.
  [ -f "$f" ] || batch+="get -p $f.sha256"$'\n'"get -p $f"$'\n'
done
if [ -n "$batch" ]; then
  printf '%s' "$batch" | sftp -q -b - "$HOST" >/dev/null || fail "sftp-hämtning misslyckades"
fi

# Verifiera varje ny fil: transport (checksumma) + att den går att dekryptera
# och packa upp med NYCKELN VI HAR. Annars upptäcks en fel nyckel först vid
# återställningen.
for f in $remote; do
  [ -f "$f.verified" ] && continue
  sha256 -c "$f.sha256" >/dev/null 2>&1 || { rm -f "$f" "$f.sha256"; fail "$f: checksumman stämmer inte"; }
  age -d -i "$KEY" "$f" | tar -tf - | grep -q 'SHA256SUMS' || fail "$f: går inte att dekryptera/packa upp"
  touch "$f.verified"
  echo "✓ $f"
done

find . -maxdepth 1 -name 'ava-*.tar.age*' -mtime +"$KEEP_DAYS" -delete

newest=$(ls -1t ava-*.tar.age 2>/dev/null | head -1)
[ -n "$newest" ] || fail "inga backuper lokalt"
age_h=$(( ( $(date +%s) - $(stat -f %m "$newest" 2>/dev/null || stat -c %Y "$newest") ) / 3600 ))
[ "$age_h" -le "$MAX_AGE_H" ] || fail "senaste backupen ($newest) är ${age_h} h gammal"
echo "✓ senaste: $newest (${age_h} h)"
