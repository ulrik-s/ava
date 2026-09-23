#!/usr/bin/env bash
#
# Krypterad backup för hämtning utanför servern.
#
# Paketerar databasen (via backup-db.sh) OCH dokumenten (volymen `content`,
# GitContentStore) i en tar, krypterar den med age till en publik nyckel, och
# lägger den i en katalog som byråns egen dator HÄMTAR ifrån (backup-pull.sh).
#
#   bash tooling/scripts/backup-export.sh /srv/ava/backup-recipient.txt /srv/backup-chroot/ava
#
# ## Varför så här
#
# - Krypterat på servern med en PUBLIK nyckel: den privata finns bara på
#   datorn som hämtar. Kapas servern kommer angriparen inte åt gamla backuper
#   (bara den publika nyckeln finns här), och transport/lagring ser bara chiffer.
# - Pull i st.f. push: servern har ingen väg in till backup-datorn och kan
#   alltså inte radera kopiorna där. Ransomware på servern ≠ förlorade backuper.
# - age körs i en engångs-container — hosten ska bara ha docker + git.
# - Dokumenten måste med: backup-db.sh tar bara Postgres, men dokumentens bytes
#   ligger i `content`-volymen. En databas som pekar på filer som inte finns
#   är ingen återställning.
set -euo pipefail

RECIPIENT="${1:-}"
OUT_DIR="${2:-}"
if [ -z "$RECIPIENT" ] || [ -z "$OUT_DIR" ] || [ ! -s "$RECIPIENT" ]; then
  echo "Användning: $0 <age-recipient-fil> <export-katalog>" >&2
  exit 2
fi

KEEP_DAYS="${AVA_EXPORT_KEEP_DAYS:-14}"
CONTENT_VOLUME="${AVA_CONTENT_VOLUME:-ava_content}"
STAMP="$(date +%F-%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Det som paketeras ligger i en EGEN katalog. Låg chiffret i samma katalog som
# tar läste såg tar katalogen ändras under läsningen ("file changed as we read
# it", exit 1) — och kunde packa in sin egen halvskrivna utfil.
DATA="$WORK/data"
mkdir "$DATA"

bash "$(dirname "$0")/backup-db.sh" "$DATA" >/dev/null
docker run --rm -v "$CONTENT_VOLUME":/content:ro -v "$DATA":/out alpine \
  tar -C /content -czf /out/content.tar.gz .
(cd "$DATA" && sha256sum ./*.gz > SHA256SUMS)

NAME="ava-$STAMP.tar.age"
tar -C "$DATA" -cf - . | docker run --rm -i -v "$(realpath "$RECIPIENT")":/recipient:ro alpine \
  sh -c 'apk add -q --no-cache age >/dev/null && age -R /recipient' > "$WORK/$NAME"

# Minsta rimliga storlek: en tom tar + age-header är några hundra byte.
SIZE=$(wc -c < "$WORK/$NAME" | tr -d ' ')
if [ "$SIZE" -lt 1000 ]; then
  echo "✗ Krypterad export är bara $SIZE byte — avbryter." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
(cd "$WORK" && sha256sum "$NAME") > "$OUT_DIR/.$NAME.sha256"
mv "$WORK/$NAME" "$OUT_DIR/.$NAME"
# Checksumman först, sedan filen — båda atomiskt synliga (rename), så
# hämtaren aldrig ser en halvskriven export.
mv "$OUT_DIR/.$NAME.sha256" "$OUT_DIR/$NAME.sha256"
mv "$OUT_DIR/.$NAME" "$OUT_DIR/$NAME"

find "$OUT_DIR" -maxdepth 1 -name 'ava-*.tar.age*' -mtime +"$KEEP_DAYS" -delete
echo "✓ $OUT_DIR/$NAME ($((SIZE / 1024)) kB)"
