#!/usr/bin/env bash
# Installerar ava-helper som en launchd-user-agent på macOS.
#
# Kör från katalogen där tar.gz-paketet är uppackat:
#   bash service/install-macos.sh
#
# Idempotent — kör om utan att skada.
set -euo pipefail

BIN_DIR="$HOME/Library/Application Support/AVA"
LOG_DIR="$HOME/Library/Logs/AVA"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_TARGET="$AGENT_DIR/se.ava.helper.plist"
LABEL="se.ava.helper"

mkdir -p "$BIN_DIR" "$LOG_DIR" "$AGENT_DIR"

# Hitta binären — antingen i samma katalog eller dit GoReleaser packar.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SOURCE="$SCRIPT_DIR/../ava-helper"
if [ ! -f "$BIN_SOURCE" ]; then
  BIN_SOURCE="$SCRIPT_DIR/ava-helper"
fi
if [ ! -f "$BIN_SOURCE" ]; then
  echo "❌ Hittade inte ava-helper-binären (letade i $BIN_SOURCE)" >&2
  exit 1
fi

# Kopiera binär + sätt execute-bit
cp "$BIN_SOURCE" "$BIN_DIR/ava-helper"
chmod +x "$BIN_DIR/ava-helper"

# Generera plist (substituera $HOME och CURRENT_USER → faktiska paths)
PLIST_SRC="$SCRIPT_DIR/se.ava.helper.plist"
sed "s|/Users/CURRENT_USER|$HOME|g" "$PLIST_SRC" > "$PLIST_TARGET"

# Ladda om launchd (unload tyst om inte registrerad)
launchctl unload "$PLIST_TARGET" 2>/dev/null || true
launchctl load -w "$PLIST_TARGET"

# Installera helperns lokala CA i login-keychain så Safari/WKWebView litar på
# HTTPS-loopback-certet (ADR 0006). Kräver en engångs-auktoriseringsprompt.
# Misslyckas tyst → HTTP funkar ändå i Chrome/Edge/Firefox.
echo "→ Installerar lokal CA i keychain (Safari/Office-add-in på Mac)…"
"$BIN_DIR/ava-helper" --install-trust || \
  echo "⚠ Kunde inte installera CA-trust automatiskt — Safari kan kräva manuell trust."

# Verifiera
sleep 1
if curl -s --max-time 2 http://127.0.0.1:48761/ping >/dev/null; then
  echo "✓ ava-helper installerat och kör"
  curl -s http://127.0.0.1:48761/ping
else
  echo "⚠ ava-helper installerat men svarar inte än. Kolla loggar:"
  echo "  $LOG_DIR/helper.log"
  echo "  $LOG_DIR/launchd.err.log"
fi
