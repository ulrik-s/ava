#!/usr/bin/env bash
#
# Kontrollera att den BYGGDA CSS:en innehåller varje klass-selektor ur en
# källfil (#1166).
#
#   bash tooling/scripts/check-built-css.sh src/app/globals.css out/_next/static/chunks/*.css
#
# Varför: Next byggcache (.next/cache) gav en gång gammal CSS i prod — nya
# regler i globals.css saknades trots rätt källkod och nya JS-chunkar, och
# inget larmade. Varje rad i källfilen som börjar med en klass-selektor och
# öppnar ett block (".bg-canvas {", ".dark .bg-white {") måste finnas någonstans
# i den byggda CSS:en som en hel selektor. Minifieraren kan slå ihop regler
# (".a,.b{…}"), så vi letar efter selektorn, inte efter en exakt regel.
#
# Utskrift: saknade selektorer. Exit 1 om någon saknas eller om ingen CSS finns.
set -euo pipefail

src="${1:?källfil saknas}"
shift
[ "$#" -gt 0 ] && [ -f "$1" ] || { echo "check-built-css: ingen byggd CSS hittades" >&2; exit 1; }
# "}" först: en selektor allra först i filen får samma avgränsare som resten.
built="}$(cat "$@")"

# Selektorn måste stå som en HEL selektor — ".bg-canvas" får inte räknas som
# funnen bara för att ".dark .bg-canvas" finns (just det fallet i #1166).
# Före: "}" / "{" (början av regel, även inuti @media) eller "," (ihopslagen).
# Efter: "{" eller ",".
has_selector() {
  local sel="$1" before after
  for before in "}" "{" ","; do
    for after in "{" ","; do
      grep -qF -- "$before$sel$after" <<<"$built" && return 0
    done
  done
  return 1
}

missing=0
while IFS= read -r selector; do
  # Minifieraren skriver ett mellanslag mellan delar och inga kring
  # kombinatorer (">", "+", "~") — normalisera källan likadant.
  selector="$(printf '%s' "$selector" | tr -s ' ' | sed -E 's/ *([>+~]) */\1/g')"
  if ! has_selector "$selector"; then
    echo "saknas i byggd CSS: $selector" >&2
    missing=$((missing + 1))
  fi
done < <(grep -E '^\.[a-zA-Z][^{,]*\{' "$src" | sed -E 's/[[:space:]]*\{.*$//')

if [ "$missing" -gt 0 ]; then
  echo "check-built-css: $missing selektor(er) ur $src saknas — gammal byggcache? Töm .next/cache och bygg om." >&2
  exit 1
fi
echo "check-built-css: alla selektorer ur $src finns i den byggda CSS:en"
