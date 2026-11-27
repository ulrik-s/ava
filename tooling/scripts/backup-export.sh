#!/usr/bin/env bash
#
# Krypterad backup för hämtning utanför servern.
#
# Paketerar databasen (via backup-db.sh) OCH dokumenten (volymen `content`,
# GitContentStore) i en tar, krypterar den med age till en publik nyckel, och
# lägger den i en katalog som byråns egen dator HÄMTAR ifrån (backup-pull.sh).
#
#   bash tooling/scripts/backup-export.sh /srv/ava/backup-recipient.txt /srv/backup-chroot/ava
#   bash tooling/scripts/backup-export.sh <mottagare> <exportkatalog> --hourly
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
#
# ## Timexporten (`--hourly`, ADR 0039)
#
# Hela databasen och bara de filer i dokumentvolymen (`.git` inräknat) som
# ändrats sedan den senaste lyckade fulla exporten STARTADE, i
# `ava-<stämpel>-hourly.tar.age`. Differentiellt mot den fulla exporten, inte en
# kedja timme för timme: basen + det senaste tillägget räcker för att återställa.
# Dokumentens bytes skrivs en gång och raderas aldrig (ADR 0023), så tillägget
# ovanpå basen ger volymens läge.
#
# Markören `.last-full` (en punktfil: hämtaren, servern och gallringen ser bara
# `ava-*`) bär basens filnamn, och dess mtime är den fulla exportens starttid.
# Den skrivs först EFTER att exporten publicerats, så en misslyckad export blir
# aldrig bas, och ett dokument som skrivs medan den fulla exporten packas hamnar
# i nästa tillägg. Saknas markören, eller filen den pekar på, blir `--hourly`
# en full export: kedjan lagar sig själv.
#
# Jämförelsen görs mot markörens mtime, aldrig mot klockslaget i namnet
# (`date +%F-%H%M` är hostens lokala tid, containern räknar i UTC). När klockan
# ställs tillbaka på hösten kan två timexporter få samma stämpel; den andra
# skriver då över den första. Det skadar inte backupen: den andra är nyare och
# innehåller allt som den första hade, eftersom båda räknas från samma bas.
set -euo pipefail

RECIPIENT="${1:-}"
OUT_DIR="${2:-}"
MODE="${3:-}"
if [ -z "$RECIPIENT" ] || [ -z "$OUT_DIR" ] || [ ! -s "$RECIPIENT" ] || { [ -n "$MODE" ] && [ "$MODE" != "--hourly" ]; }; then
  echo "Användning: $0 <age-recipient-fil> <export-katalog> [--hourly]" >&2
  exit 2
fi

KEEP_DAYS="${AVA_EXPORT_KEEP_DAYS:-14}"
KEEP_HOURLY_H="${AVA_EXPORT_KEEP_HOURLY_H:-48}"
CONTENT_VOLUME="${AVA_CONTENT_VOLUME:-ava_content}"
MARKER="$OUT_DIR/.last-full"
STAMP="$(date +%F-%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Starttiden: blir markörens mtime när den fulla exporten är publicerad.
touch "$WORK/started"
# Det som paketeras ligger i en EGEN katalog. Låg chiffret i samma katalog som
# tar läste såg tar katalogen ändras under läsningen ("file changed as we read
# it", exit 1) — och kunde packa in sin egen halvskrivna utfil.
DATA="$WORK/data"
mkdir "$DATA"

# Basen för en timexport: markörens fulla export, om den finns kvar. Annars tomt.
current_base() {
  [ -f "$MARKER" ] || return 0
  local base
  base="$(head -n 1 "$MARKER")"
  if [ -n "$base" ] && [ -f "$OUT_DIR/$base" ]; then echo "$base"; fi
}

# Hela volymen (full export).
pack_full_content() {
  docker run --rm -v "$CONTENT_VOLUME":/content:ro -v "$DATA":/out alpine \
    tar -C /content -czf /out/content.tar.gz .
}

# Bara filer nyare än markören. GNU tar (busybox-tar saknar --newer-mtime) tar
# ett filnamn som datum och läser dess mtime. Inga ändringar → ett tomt, giltigt arkiv.
pack_content_diff() {
  docker run --rm -v "$CONTENT_VOLUME":/content:ro -v "$DATA":/out -v "$(realpath "$MARKER")":/marker:ro alpine \
    sh -c 'apk add -q --no-cache tar >/dev/null && tar -C /content --newer-mtime=/marker -czf /out/content-diff.tar.gz .'
}

# Krypterar $DATA till $WORK/$1 och publicerar den atomiskt i $OUT_DIR.
encrypt_and_publish() {
  local name="$1" size
  tar -C "$DATA" -cf - . | docker run --rm -i -v "$(realpath "$RECIPIENT")":/recipient:ro alpine \
    sh -c 'apk add -q --no-cache age >/dev/null && age -R /recipient' > "$WORK/$name"

  # Minsta rimliga storlek: en tom tar + age-header är några hundra byte.
  size=$(wc -c < "$WORK/$name" | tr -d ' ')
  if [ "$size" -lt 1000 ]; then
    echo "✗ Krypterad export är bara $size byte — avbryter." >&2
    exit 1
  fi

  mkdir -p "$OUT_DIR"
  (cd "$WORK" && sha256sum "$name") > "$OUT_DIR/.$name.sha256"
  mv "$WORK/$name" "$OUT_DIR/.$name"
  # Checksumman först, sedan filen — båda atomiskt synliga (rename), så
  # hämtaren aldrig ser en halvskriven export.
  mv "$OUT_DIR/.$name.sha256" "$OUT_DIR/$name.sha256"
  mv "$OUT_DIR/.$name" "$OUT_DIR/$name"
  echo "✓ $OUT_DIR/$name ($((size / 1024)) kB)"
}

# Markören, atomiskt som exporten: basens namn, med exportens starttid som mtime.
write_marker() {
  echo "$1" > "$OUT_DIR/.last-full.tmp"
  touch -r "$WORK/started" "$OUT_DIR/.last-full.tmp"
  mv "$OUT_DIR/.last-full.tmp" "$MARKER"
}

BASE=""
if [ "$MODE" = "--hourly" ]; then
  BASE="$(current_base)"
  [ -n "$BASE" ] || echo "• Ingen bas för timexporten — gör en full export." >&2
fi

bash "$(dirname "$0")/backup-db.sh" "$DATA" >/dev/null
if [ -n "$BASE" ]; then
  pack_content_diff
  echo "$BASE" > "$DATA/BASE"
  (cd "$DATA" && sha256sum ./*.gz ./BASE > SHA256SUMS)
  encrypt_and_publish "ava-$STAMP-hourly.tar.age"
else
  pack_full_content
  (cd "$DATA" && sha256sum ./*.gz > SHA256SUMS)
  NAME="ava-$STAMP.tar.age"
  encrypt_and_publish "$NAME"
  write_marker "$NAME"
fi

# Gallring per sort: den ena tar aldrig den andra sortens filer.
find "$OUT_DIR" -maxdepth 1 -name 'ava-*.tar.age*' ! -name 'ava-*-hourly.tar.age*' -mtime +"$KEEP_DAYS" -delete
find "$OUT_DIR" -maxdepth 1 -name 'ava-*-hourly.tar.age*' -mmin +"$((KEEP_HOURLY_H * 60))" -delete
