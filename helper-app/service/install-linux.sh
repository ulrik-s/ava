#!/usr/bin/env bash
# Installerar ava-helper som systemd user-service på Linux.
#
# Kör från katalogen där tar.gz-paketet är uppackat:
#   bash service/install-linux.sh
set -euo pipefail

BIN_DIR="$HOME/.local/share/AVA"
LOG_DIR="$HOME/.local/state/AVA"
UNIT_DIR="$HOME/.config/systemd/user"

mkdir -p "$BIN_DIR" "$LOG_DIR" "$UNIT_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SOURCE="$SCRIPT_DIR/../ava-helper"
if [ ! -f "$BIN_SOURCE" ]; then
  BIN_SOURCE="$SCRIPT_DIR/ava-helper"
fi
if [ ! -f "$BIN_SOURCE" ]; then
  echo "❌ Hittade inte ava-helper-binären (letade i $BIN_SOURCE)" >&2
  exit 1
fi

cp "$BIN_SOURCE" "$BIN_DIR/ava-helper"
chmod +x "$BIN_DIR/ava-helper"

cp "$SCRIPT_DIR/ava-helper.service" "$UNIT_DIR/ava-helper.service"

systemctl --user daemon-reload
systemctl --user enable --now ava-helper

sleep 1
if curl -s --max-time 2 http://127.0.0.1:48761/ping >/dev/null; then
  echo "✓ ava-helper installerat och kör"
  curl -s http://127.0.0.1:48761/ping
else
  echo "⚠ ava-helper installerat men svarar inte än. Kolla loggar:"
  echo "  journalctl --user -u ava-helper -f"
fi
