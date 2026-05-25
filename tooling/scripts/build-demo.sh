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

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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
  "templates/[id]"
  "users/[id]"
)

# Routes som ska få en placeholder-sida ("Feature unavailable in demo")
# istället för att bara 404:a när användaren klickar i sidopanelen.
# Notera att "api" och "login" inte syns i sidobar — ingen placeholder.
#
# /settings, /users, /profile och /templates är *inte* placeholders — alla
# fungerar mot DemoDataStore via demo-trpc-link.
PLACEHOLDER_ROUTES=()

cleanup() {
  if [[ -d "$STASH_DIR" ]]; then
    echo "[build-demo] Återställer stashade sidor..."
    # Ta först bort placeholder-sidor om de skapats
    for route in "${PLACEHOLDER_ROUTES[@]}"; do
      rm -rf "$APP_DIR/$route" 2>/dev/null || true
    done
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

# Skriv placeholder-sidor så menyklick på stashade routes inte 404:ar
echo "[build-demo] Skriver placeholders för $(IFS=,; echo "${PLACEHOLDER_ROUTES[*]}")..."
declare -A ROUTE_TITLES=(
  ["users"]="Användare"
  ["templates"]="Dokumentmallar"
)
declare -A ROUTE_DESCS=(
  ["users"]="Hantering av advokater och biträden på byrån."
  ["templates"]="Återanvändbara dokumentmallar som kan auto-fyllas från ärendedata."
)
for route in "${PLACEHOLDER_ROUTES[@]}"; do
  mkdir -p "$APP_DIR/$route"
  cat > "$APP_DIR/$route/page.tsx" <<EOFTSX
/**
 * Placeholder för demo-build. Den riktiga $route-sidan kräver
 * server-side data som demo:n saknar. Genereras automatiskt av
 * scripts/build-demo.sh och raderas vid återställning.
 */
import { FeatureUnavailable } from "@/client/components/feature-unavailable";

export default function PlaceholderPage() {
  return (
    <FeatureUnavailable
      title="${ROUTE_TITLES[$route]}"
      description="${ROUTE_DESCS[$route]}"
    />
  );
}
EOFTSX
done

echo "[build-demo] Kör next build (DEMO_BUILD=1)..."
DEMO_BUILD=1 \
NEXT_PUBLIC_DEMO_BUILD=1 \
DEMO_BASE_PATH="${DEMO_BASE_PATH:-/ava}" \
  yarn next build

# ─── Seed: kör samma buildSeed som docker-firma:n men med demo-args ─────
# Resultatet (JSON + PDF/DOCX) skrivs direkt in i `out/` så pages-sajten
# serverar både app:en och datan från samma origin. Då slipper vi en
# separat data-repo + slipper CORS.
echo "[build-demo] Seedar demo-data direkt i out/..."
yarn tsx tooling/scripts/build-demo-repo.ts --dir "$ROOT/out"

echo "[build-demo] Genererar manifest.json över out/..."
yarn tsx tooling/scripts/generate-demo-manifest.ts "$ROOT/out"

# .nojekyll: utan denna fil ignorerar GitHub Pages alla dotfile-mappar
# (t.ex. /.ava/users/) → users + org-data skulle 404:a.
touch "$ROOT/out/.nojekyll"

echo "[build-demo] Klar. Output: $ROOT/out/"
echo "  • App: $(find "$ROOT/out" -name '*.html' | wc -l | tr -d ' ') HTML-filer"
echo "  • Data: $(grep -c '"' "$ROOT/out/manifest.json" 2>/dev/null || echo 0) entiteter i manifest"
echo "  • Binärer: $(find "$ROOT/out/documents/content" -type f 2>/dev/null | wc -l | tr -d ' ') PDF/DOCX"
