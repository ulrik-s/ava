#!/usr/bin/env bash
# Röktest för server-runtime-containern (#81).
#
# Bygger linux-binärerna + docker-imagen och kör containern `--once` mot ett
# lokalt bare-repo (file://, ingen auth). Verifierar att containern:
#   - startar och väljer rätt binär,
#   - klonar firma.git till sin working-copy,
#   - kör en sync-tick och avslutar 0.
#
# Detta täcker deploy-paketeringen (#81) utan att kräva hela compose-stacken.
# Kräver: docker + bun + git.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

IMAGE="ava-server-runtime:smoke"

echo "==> [1/3] Bygger linux-binärer (server-runtime:build)…"
bun run server-runtime:build

echo "==> [2/3] Bygger docker-image ${IMAGE} …"
docker build -f tooling/docker/server-runtime/Dockerfile -t "$IMAGE" .

echo "==> [3/3] Kör containern --once mot ett lokalt bare-repo…"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BARE="$WORK/firma.git"
SEED="$WORK/seed"
git init --bare -b main "$BARE" >/dev/null
git clone -q "$BARE" "$SEED"
git -C "$SEED" -c user.email=smoke@ava.local -c user.name=smoke commit -q --allow-empty -m "seed"
git -C "$SEED" push -q origin main

OUT="$(docker run --rm \
  -e AVA_SR_REPO_URL="file:///bare/firma.git" \
  -e AVA_SR_ORG_ID="smoke-org" \
  -v "$BARE":/bare/firma.git:ro \
  "$IMAGE" --once 2>&1)"
echo "----- container-logg -----"
echo "$OUT"
echo "--------------------------"

echo "$OUT" | grep -q "klonar" || { echo "❌ FEL: containern klonade inte firma.git"; exit 1; }
echo "✅ server-runtime-container röktest OK (byggd, klonade, tickade, avslutade 0)"
