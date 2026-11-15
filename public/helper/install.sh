#!/bin/bash
# AVA Helper — installation på macOS med en rad i Terminal:
#
#   curl -fsSL https://<din AVA>/helper/install.sh | bash
#
# Appen är inte signerad av Apple än. Hämtad med curl får den ingen
# karantän-markering, så Gatekeeper stoppar den inte. Ingen sudo: appen
# hamnar i ~/Applications. Kontrollsumman (SHA-256) från samma release
# kontrolleras före installationen. Se docs/helper-installation.md.
set -euo pipefail

REPO="ulrik-s/ava"
[ "$(uname -s)" = Darwin ] || { echo "Det här skriptet är för macOS." >&2; exit 1; }
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "Okänd processor: $(uname -m)" >&2; exit 1 ;;
esac

ZIP="AVA-Helper-mac-$ARCH.zip"
BASE="https://github.com/$REPO/releases/latest/download"
APPS="$HOME/Applications"
APP="$APPS/AVA Helper.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Hämtar AVA Helper ($ARCH)…"
curl -fsSL "$BASE/$ZIP" -o "$TMP/$ZIP"
curl -fsSL "$BASE/$ZIP.sha256" -o "$TMP/$ZIP.sha256"
(cd "$TMP" && shasum -a 256 -c "$ZIP.sha256" >/dev/null) || { echo "Kontrollsumman stämmer inte — avbryter." >&2; exit 1; }

# Byt ut en äldre version om den kör.
osascript -e 'tell application "AVA Helper" to quit' >/dev/null 2>&1 || true
sleep 1
mkdir -p "$APPS"
rm -rf "$APP"
ditto -x -k "$TMP/$ZIP" "$APPS"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "Startar AVA Helper…"
echo "macOS frågar strax efter ditt lösenord för att godkänna AVA:s certifikat"
echo "(behövs för Safari och Outlook-tillägget). Det är förväntat."
open "$APP"
echo "Klart. AVA-ikonen finns i menyraden och startar själv när du loggar in."
