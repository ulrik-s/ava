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

# Sidor som inte kan ingå i den statiska demon. De flyttas åt sidan innan
# build och återställs efteråt.
#
# HISTORIK: denna array var länge en genväg — dynamiska rutter som saknade
# generateStaticParams() stashades bort istället för att fixas, vilket gav
# 404 → SPA-fallback-loopar (invoices, templates, users). ALLA dynamiska
# rutter har nu generateStaticParams (demoStaticParams /
# demoStaticParamsBySeedId) så ingen behöver stashas.
#
# Bara ÄKTA server-only-routes hör hemma här — sådana som blockerar
# `output: "export"` (route handlers under api/) eller kräver en server.
# De mapparna finns inte i src/app/ just nu → arrayen är tom. Lägg BARA
# till en route här om den faktiskt har en route.ts (server handler) —
# aldrig en sida bara för att den "inte hunnit få" static-params.
STASH_PATHS=()

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
  bunx next build

# ─── Seed: kör samma buildSeed som docker-firma:n men med demo-args ─────
# Resultatet (JSON + PDF/DOCX) skrivs direkt in i `out/` så pages-sajten
# serverar både app:en och datan från samma origin. Då slipper vi en
# separat data-repo + slipper CORS.
echo "[build-demo] Seedar demo-data direkt i out/..."
bun tooling/scripts/build-demo-repo.ts --dir "$ROOT/out"

echo "[build-demo] Genererar manifest.json över out/..."
bun tooling/scripts/generate-demo-manifest.ts "$ROOT/out"

# demo-seed.json (#544, ADR 0025): EN bundlad seed som klienten hämtar i st.f.
# manifest + N filer → hydrerar cachen via den riktiga reconcile/pull-vägen.
echo "[build-demo] Genererar demo-seed.json över out/..."
bun tooling/scripts/generate-demo-seed.ts "$ROOT/out"

# .nojekyll: utan denna fil ignorerar GitHub Pages alla dotfile-mappar
# (t.ex. /.ava/users/) → users + org-data skulle 404:a.
touch "$ROOT/out/.nojekyll"

# SPA-fallback: GH Pages serverar 404.html för okända URL:er. Att bara
# kopiera index.html funkar INTE för runtime-skapade id:n: index.html:s
# bakade route är dashboarden, så /invoices/<nytt-id>/ renderar dashboarden
# (och Next hård-navigerar icke-pre-renderade params → loop om man försöker
# router.replace till själva id:t).
#
# Lösning (shell-routing-shim): 404.html är ett pytte-skript som mappar en
# okänd entity-URL till den PRE-RENDERADE `__shell__`-sentinellen och bär det
# egentliga id:t i hash:en (#orig=<path>). __shell__ är en riktig 200-fil →
# ingen 404-loop; appen bootar där och `useRouteId` läser id:t ur hash:en.
# Svans-segment bevaras (segs.slice(2)) så nästlade routes funkar.
# Okända icke-entity-URL:er → app-roten (dashboard).
#
# NB: `templates` har INGEN platt [id]-detalj — bara templates/[id]/edit. Det
# finns därför ingen `templates/__shell__/`-fil, bara `templates/__shell__/edit/`.
# All app-länkning till mallar går via /edit (EntityLink sub="edit"), så detta
# räcker. En bar `/templates/<id>/` (deep-link utan /edit) saknar shell och
# faller därför till dashboarden — medvetet, inte en route i appen.
cat > "$ROOT/out/404.html" <<'HTML'
<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>AVA</title><meta name="robots" content="noindex"></head>
<body><script>
(function(){
  var SHELL=["invoices","matters","contacts","payment-plans","users","templates"];
  var base="__BASEPATH__";
  var path=location.pathname;
  var rest=(base && path.indexOf(base)===0)?path.slice(base.length):path;
  var segs=rest.split("/").filter(Boolean);
  var last=segs.length?segs[segs.length-1]:"";
  var isAsset=path.indexOf("/_next/")!==-1 || last.indexOf(".")!==-1;
  if(!isAsset && segs.length>=2 && SHELL.indexOf(segs[0])!==-1 && segs[1]!=="__shell__"){
    // Byt ut id-segmentet (segs[1]) mot __shell__ men BEHÅLL svans-segment
    // (t.ex. /templates/<id>/edit/ → /templates/__shell__/edit/) så nästlade
    // routes landar på rätt pre-renderade sentinel. Plattа routes (segs.length
    // ===2) ger /<route>/__shell__/. useRouteId läser id:t ur #orig-hashen.
    var tail=segs.slice(2).join("/");
    location.replace(base+"/"+segs[0]+"/__shell__/"+(tail?tail+"/":"")+"#orig="+encodeURIComponent(path+location.search));
  } else if(!isAsset){ location.replace(base+"/"); }
  else { document.title="404"; document.body.textContent="404"; }
})();
</script></body></html>
HTML
# Baka in basePath (portabelt — node finns redan i bygget; sed -i skiljer sig mac/linux)
node -e 'const f=process.argv[1],fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("__BASEPATH__",process.env.DEMO_BASE_PATH||""))' "$ROOT/out/404.html"

echo "[build-demo] Klar. Output: $ROOT/out/"
echo "  • App: $(find "$ROOT/out" -name '*.html' | wc -l | tr -d ' ') HTML-filer"
echo "  • Data: $(grep -c '"' "$ROOT/out/manifest.json" 2>/dev/null || echo 0) entiteter i manifest"
echo "  • Binärer: $(find "$ROOT/out/documents/content" -type f 2>/dev/null | wc -l | tr -d ' ') PDF/DOCX"
