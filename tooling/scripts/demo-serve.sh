#!/usr/bin/env bash
#
# demo-serve.sh — bygg gh-pages-demon och servera lokalt via nginx i docker
# som speglar GitHub Pages-beteendet EXAKT (404 → /404.html, samma URL-prefix).
#
# Användning:
#   bash tooling/scripts/demo-serve.sh
#   # eller via package.json:
#   bun run demo:serve
#
# Öppna sedan http://localhost:8080/ava/ i webbläsaren.
# Ctrl-C stoppar nginx-containern.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PORT="${DEMO_PORT:-8080}"
CONTAINER_NAME="ava-demo-local"

# Bygg om varje gång — billigt om out/ finns och Next använder cachen.
# Sätt SKIP_BUILD=1 om du redan har byggt och bara vill starta servern.
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  echo "[demo-serve] Bygger out/ via build-demo.sh..."
  DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh
fi

if [[ ! -d "$ROOT/out" ]]; then
  echo "[demo-serve] out/ saknas. Kör utan SKIP_BUILD=1 för att bygga." >&2
  exit 1
fi

# Stoppa ev. tidigare instans
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "[demo-serve] Startar nginx på http://localhost:$PORT/ava/"
echo "[demo-serve] (404 → /404.html, precis som GH Pages. Ctrl-C avbryter.)"
exec docker run --rm \
  --name "$CONTAINER_NAME" \
  -p "$PORT:80" \
  -v "$ROOT/out:/usr/share/nginx/html:ro" \
  -v "$ROOT/tooling/docker/nginx-demo.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine
