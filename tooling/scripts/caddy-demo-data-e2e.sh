#!/usr/bin/env bash
#
# Caddy-E2E för #1352: prod-Caddyn svarar 404 på demodata.
#
#   bash tooling/scripts/caddy-demo-data-e2e.sh
#
# Startar den RIKTIGA Caddyfile:n i caddy:2-alpine (samma image och samma
# releases/-mount som docker-compose.production.yml) mot en release som har
# allt ett demo-bygge lägger i out/ — som en release byggd före #1352, t.ex.
# efter en rollback. Demodatan ska ge 404; skalet, PWA-manifestet och
# shell-rewriten för runtime-id:n ska fortfarande fungera. Kräver docker + curl.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${AVA_CADDY_E2E_PORT:-18352}"
NAME="ava-caddy-e2e-$$"
WORK="$(mktemp -d)"
FAILS=0

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

put() { mkdir -p "$(dirname "$WORK/releases/r1/$1")" && printf '%s' "${2:-x}" > "$WORK/releases/r1/$1"; }

put index.html "skal"
put manifest.json '{"name":"AVA"}'
put matters/__shell__/index.html "shell"
put demo-seed.json "{}"
put .ava/meta.json "{}"
put .ava/users/anna@ava.demo.json "{}"
put matters/active/m1.json "{}"
put contacts/c1.json "{}"
put documents/content/stamning.pdf "%PDF"
ln -s r1 "$WORK/releases/current"
chmod -R a+rX "$WORK"

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:80" -e AVA_DOMAIN=:80 \
  -v "$ROOT/tooling/docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$WORK/releases:/srv/releases:ro" \
  caddy:2-alpine >/dev/null

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
done

expect_code() {
  local want="$1" path="$2" got
  got="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$path")"
  if [ "$got" = "$want" ]; then
    echo "ok   $got $path"
  else
    echo "FEL  $got $path (väntade $want)" >&2
    FAILS=$((FAILS + 1))
  fi
}

expect_code 404 /demo-seed.json
expect_code 404 /.ava/meta.json
expect_code 404 /.ava/users/anna@ava.demo.json
expect_code 404 /matters/active/m1.json
expect_code 404 /contacts/c1.json
expect_code 404 /documents/content/stamning.pdf
expect_code 200 /
expect_code 200 /manifest.json
expect_code 200 /matters/0fb22dd8-566b-566e-9dfc-4238f1941b67/

if [ "$FAILS" -ne 0 ]; then
  docker logs "$NAME" 2>&1 | tail -20 >&2
  exit 1
fi
echo "Caddy nekar demodata (#1352)."
