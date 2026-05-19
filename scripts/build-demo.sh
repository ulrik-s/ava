#!/usr/bin/env bash
#
# build-demo.sh — bygger den statiska demo-exporten för GitHub Pages.
#
# Steg:
#   1. Stash:a `src/app/api/` (server-routes kan inte statiskt exporteras)
#   2. Stash:a server-only pages som inte ska finnas i demon
#   3. Kör `DEMO_BUILD=1 next build` → out/
#   4. Återställ flyttade filer (oavsett om bygget lyckades)
#
# Env-variabler:
#   DEMO_BASE_PATH  Bas-sökväg för GH Pages (default: "/ava")
#
# Demo-data hämtas från en separat GH Pages-publicerad repo
# (default `https://<user>.github.io/<demo-repo>`). Inga CORS-proxyn,
# inga externa tjänster — bara GitHub. Se `gh-pages-loader.ts`.
#
# Output: out/-mappen, redo för GH Pages.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STASH_DIR="$ROOT/.demo-stash"
APP_DIR="$ROOT/src/app"

# Sidor som inte ska ingå i den statiska demon. De flyttas åt sidan
# innan build och återställs efteråt.
#
# MVP: Bara `/` och `/demo` ingår. Dynamiska rutter (matters/[id] etc.)
# och server-rutter (api, login) lämnas utanför demo-builden tills vi
# har generateStaticParams() på dem.
STASH_PATHS=(
  "api"
  "login"
  "settings"
  "users"
  "templates"
)

cleanup() {
  if [[ -d "$STASH_DIR" ]]; then
    echo "[build-demo] Återställer stashade sidor..."
    for p in "${STASH_PATHS[@]}"; do
      if [[ -d "$STASH_DIR/$p" ]]; then
        rm -rf "$APP_DIR/$p"
        mkdir -p "$(dirname "$APP_DIR/$p")"
        mv "$STASH_DIR/$p" "$APP_DIR/$p"
      fi
    done
    find "$STASH_DIR" -type d -empty -delete 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$STASH_DIR"

echo "[build-demo] Stash:ar server-only sidor..."
for p in "${STASH_PATHS[@]}"; do
  if [[ -d "$APP_DIR/$p" ]]; then
    mkdir -p "$(dirname "$STASH_DIR/$p")"
    mv "$APP_DIR/$p" "$STASH_DIR/$p"
  fi
done

echo "[build-demo] Kör next build (DEMO_BUILD=1)..."
DEMO_BUILD=1 \
NEXT_PUBLIC_DEMO_BUILD=1 \
DEMO_BASE_PATH="${DEMO_BASE_PATH:-/ava}" \
  yarn next build

echo "[build-demo] Klar. Output: $ROOT/out/"
