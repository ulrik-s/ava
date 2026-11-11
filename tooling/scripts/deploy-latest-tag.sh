#!/usr/bin/env bash
#
# Deploy via tagg: körs av ava-deploy.timer var femte minut på servern.
#
#   git tag v1.2.0 && git push origin v1.2.0     # på en utvecklardator
#   → inom fem minuter: deploy-prod.sh --tag v1.2.0 på servern
#
# Servern hämtar själv — ingen nyckel i GitHub, ingen väg in till servern.
# Bara taggar som börjar på "v" räknas (helper-v* är helperns), högsta
# versionen vinner (v1.10.0 > v1.9.0). Pekar den deployade releasen redan på
# taggens commit händer ingenting. Faller deployen körs den inte om på samma
# tagg: rätta felet och kör deploy-prod.sh --tag för hand, eller sätt en ny
# tagg. Loggen: journalctl -u ava-deploy.
#
# Staging (docs/feedback-pipeline.md): med AVA_DEPLOY_TRACK=main i
# ava-server.env deployas i stället toppen av origin/main (deploy-prod.sh utan
# --tag) varje gång main flyttar sig. Allt annat är som i produktion.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=tooling/scripts/lib/release.sh
. tooling/scripts/lib/release.sh

# Testerna byter ut deployen; i drift är det deploy-prod.sh.
DEPLOY="${AVA_DEPLOY_CMD:-bash tooling/scripts/deploy-prod.sh}"
FAILED="$RELEASES_DIR/.deploy-failed"
# Saknad ava-server.env = taggläge (sed:s fel får inte fälla skriptet via pipefail).
track="${AVA_DEPLOY_TRACK:-$({ sed -n 's/^AVA_DEPLOY_TRACK=//p' ava-server.env 2>/dev/null || true; } | tr -d '"' | tail -1)}"

git fetch -q origin --tags
if [ "$track" = main ]; then
  want="$(git rev-parse origin/main)"
  name="main@${want:0:8}"
  args=()
else
  tag="$(git tag --list 'v*' --sort=-v:refname | head -1)"
  [ -n "$tag" ] || { echo "ingen v*-tagg — inget att deploya"; exit 0; }
  want="$(git rev-parse "$tag^{commit}")"
  name="$tag"
  args=(--tag "$tag")
fi

# Releasen heter <tid>-<sha>[.n] (eller -bootstrap); en okänd sha är ≠ målet.
current="$(release_current)"
label="${current#*-}"
have="$(git rev-parse --verify --quiet "${label%%.*}^{commit}" || true)"
if [ "$have" = "$want" ]; then
  echo "$name är redan deployad ($current)"
  exit 0
fi

# ponytail: en markör i stället för backoff — timern får inte bygga om var
# femte minut på något som inte går att deploya. Ny tagg/commit → nytt försök.
if [ -f "$FAILED" ] && [ "$(cat "$FAILED")" = "$name" ]; then
  echo "$name föll förra gången — rätta och kör för hand: bash tooling/scripts/deploy-prod.sh ${args[*]+"${args[*]}"}" >&2
  exit 1
fi

echo "ny version $name (${want:0:8}) — deployar"
if $DEPLOY ${args[@]+"${args[@]}"}; then
  rm -f "$FAILED"
else
  mkdir -p "$RELEASES_DIR"
  echo "$name" > "$FAILED"
  exit 1
fi
