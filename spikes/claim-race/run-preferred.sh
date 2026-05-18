#!/usr/bin/env bash
set -euo pipefail

ROOT="/tmp/spike-claim-race-preferred"
NUM_WORKERS=15
SOLO_PER_WORKER=10
SHARED_EVENT="evt-shared-001"

cd "$(dirname "${BASH_SOURCE[0]}")"
SPIKE_DIR="$(pwd)"

rm -rf "$ROOT"
mkdir -p "$ROOT"
git init --bare --quiet --initial-branch=main "$ROOT/origin.git"

mkdir -p "$ROOT/seed/claims"
touch "$ROOT/seed/claims/today.jsonl"
git -C "$ROOT/seed" init --quiet --initial-branch=main
git -C "$ROOT/seed" add .
git -C "$ROOT/seed" -c user.email=seed@spike -c user.name=seed commit --quiet -m "init"
git -C "$ROOT/seed" remote add origin "$ROOT/origin.git"
git -C "$ROOT/seed" push --quiet origin main

for i in $(seq 1 $NUM_WORKERS); do
  git clone --quiet "$ROOT/origin.git" "$ROOT/worker-$i"
done

USERS=$(seq 1 $NUM_WORKERS | sed 's/^/u/' | tr '\n' ',' | sed 's/,$//')

echo ">>> Variant: preferred-runner. $NUM_WORKERS workers."
START=$(node -e 'process.stdout.write(String(Date.now()))')

PIDS=()
for i in $(seq 1 $NUM_WORKERS); do
  node "$SPIKE_DIR/worker-preferred.js" \
    --workdir "$ROOT/worker-$i" --user "u$i" --users "$USERS" \
    --shared-event "$SHARED_EVENT" --solo-count "$SOLO_PER_WORKER" \
    --max-retries 50 \
    > "$ROOT/result-$i.json" 2>"$ROOT/err-$i.log" &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done

END=$(node -e 'process.stdout.write(String(Date.now()))')
TOTAL_MS=$((END - START))

node "$SPIKE_DIR/analyze.js" "$ROOT" "$NUM_WORKERS" "$SOLO_PER_WORKER" "$TOTAL_MS"
