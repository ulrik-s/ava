#!/usr/bin/env bash
#
# Självständig runner för dokument-pipeline-E2E:n (server-first-stacken).
# Bygger binären, startar Postgres + server-first i docker, migrerar, kör
# `document-pipeline-e2e.ts` och river ner. Speglar mönstret i CI:s
# server-first-e2e-jobb (docker-compose.server-first.yml).
#
#   bash tooling/scripts/document-pipeline-e2e.sh           # heuristik (snabb, deterministisk)
#   bash tooling/scripts/document-pipeline-e2e.sh --llm     # + ollama (server-LLM-klassificering)
#
# --llm: drar upp ollama (--profile llm), hämtar en liten modell och pekar
# server-first på den via AVA_LLM_ENDPOINT/MODEL. Klassificeringen går då via
# ollama (fail-soft till filnamns-heuristiken → samma assertion håller).
set -euo pipefail

COMPOSE="tooling/docker/docker-compose.server-first.yml"
DB_URL="postgres://ava:ava@localhost:5433/ava_test"
ORG="00000000-0000-0000-0000-000000000001"
LLM_MODEL="${AVA_LLM_MODEL:-qwen2.5:0.5b}"
USE_LLM=0
[[ "${1:-}" == "--llm" ]] && USE_LLM=1

cleanup() { docker compose -f "$COMPOSE" --profile llm down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▸ Bygger server-first-binären…"
bun run server-first:build

echo "▸ Startar Postgres + server-first…"
if [[ "$USE_LLM" == "1" ]]; then
  docker compose -f "$COMPOSE" --profile llm up -d --build --wait --wait-timeout 180
  echo "▸ Hämtar LLM-modell ($LLM_MODEL)…"
  docker compose -f "$COMPOSE" exec -T ollama ollama pull "$LLM_MODEL"
  echo "▸ Pekar server-first på ollama…"
  AVA_LLM_ENDPOINT="http://ollama:11434/v1" AVA_LLM_MODEL="$LLM_MODEL" \
    docker compose -f "$COMPOSE" up -d server-first --wait --wait-timeout 120
else
  docker compose -f "$COMPOSE" up -d --build --wait --wait-timeout 180
fi

echo "▸ Migrerar schemat…"
AVA_DATABASE_URL="$DB_URL" bun run db:migrate

echo "▸ Kör dokument-pipeline-E2E…"
# I LLM-läget relaxeras kategori-assertionen (ollama är icke-deterministisk) —
# se E2E_LLM i document-pipeline-e2e.ts.
SERVER_URL="http://localhost:3001" AVA_DATABASE_URL="$DB_URL" AVA_ORGANIZATION_ID="$ORG" E2E_LLM="$USE_LLM" \
  bun tooling/scripts/document-pipeline-e2e.ts

echo "✓ dokument-pipeline-E2E klar."
