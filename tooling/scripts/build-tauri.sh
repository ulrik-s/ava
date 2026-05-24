#!/usr/bin/env bash
#
# build-tauri.sh — bygger Next.js som statisk export för Tauri-bundle.
#
# Skillnad mot build-demo.sh:
#   - DEMO_BUILD=1 sätts (för output: "export") men NEXT_PUBLIC_DEMO_BUILD
#     är 0 → SessionProvider + AuthGuard + tRPC fungerar normalt.
#   - Inga stash:ade routes — full app:n ingår.
#   - Tauri pratar med sin egen Rust-backend för fs/git, inte med tRPC.
#     API-routes som anropar Prisma:n körs bara om en användare faktiskt
#     försöker (då kraschar de tyst eftersom ingen server kör).
#
# Output: out/ (Tauri:s beforeBuildCommand pekar hit)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Tauri pekar mot frontendDist: "../out" från src-tauri/. basePath
# måste vara tom (inte /ava som demo).
echo "[build-tauri] Stash:ar dynamiska routes som saknar generateStaticParams..."
STASH="$ROOT/.tauri-stash"
mkdir -p "$STASH"

# Inkludera samma som demo-build:n PLUS templates/[id] som inte
# har generateStaticParams än.
STASH_PATHS=("api" "templates" "users/[id]" "users/new")

for p in "${STASH_PATHS[@]}"; do
  if [[ -d "$ROOT/src/app/$p" ]]; then
    mkdir -p "$(dirname "$STASH/$p")"
    mv "$ROOT/src/app/$p" "$STASH/$p"
  fi
done

cleanup() {
  for p in "${STASH_PATHS[@]}"; do
    if [[ -d "$STASH/$p" ]]; then
      rm -rf "$ROOT/src/app/$p"
      mkdir -p "$(dirname "$ROOT/src/app/$p")"
      mv "$STASH/$p" "$ROOT/src/app/$p"
    fi
  done
  find "$STASH" -type d -empty -delete 2>/dev/null || true
}
trap cleanup EXIT

echo "[build-tauri] Kör next build (DEMO_BUILD=1 men NEXT_PUBLIC_DEMO_BUILD=0)..."
DEMO_BUILD=1 \
NEXT_PUBLIC_DEMO_BUILD=0 \
DEMO_BASE_PATH="" \
  yarn next build

echo "[build-tauri] Klar. Output: $ROOT/out/"
