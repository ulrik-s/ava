#!/usr/bin/env bash
#
# Skapar (eller uppdaterar) agentkedjans etiketter i intag- och kodrepot ur
# tooling/agents/labels.json. Idempotent — kör om när listan ändras.
#
#   bash tooling/scripts/setup-agent-labels.sh [intag-repo] [kod-repo]
#   (default ulrik-s/ava-feedback och ulrik-s/ava)
set -euo pipefail

INTAKE="${1:-ulrik-s/ava-feedback}"
CODE="${2:-ulrik-s/ava}"
LABELS="$(dirname "$0")/../agents/labels.json"

create() {
  local repo="$1" group="$2"
  jq -c ".${group}[]" "$LABELS" | while read -r l; do
    gh label create "$(jq -r .name <<<"$l")" -R "$repo" --force \
      --color "$(jq -r .color <<<"$l")" --description "$(jq -r .description <<<"$l")"
  done
}

create "$INTAKE" intake
create "$CODE" code
echo "✓ etiketter i $INTAKE och $CODE"
