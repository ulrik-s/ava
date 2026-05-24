#!/usr/bin/env bash
# Kör HELA test-stacken lokalt — speglar exakt vad CI gör.
#
# Lager:
#   - static:      typecheck + lint + deps:check + duplicates + knip
#   - vitest:      unit + komponent + integration (med coverage)
#   - build:       yarn build (production Next.js)
#   - demo-build:  bash tooling/scripts/build-demo.sh (statisk export för GH Pages)
#   - e2e:         Playwright round-trip mot tier 3-stacken (docker-compose.yml)
#
# Arkitekturen är pure git-modell — ingen Postgres längre. Dev-stacken
# (postgres+meili+tika) togs bort i samband med Prisma-borttagningen.
#
# Användning:
#   yarn test:all              # hela stacken inkl. e2e (kräver docker)
#   yarn test:all --no-e2e     # hoppar e2e + docker (fast lokal feedback)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SKIP_E2E=0
for arg in "$@"; do
  case "$arg" in
    --no-docker|--no-e2e) SKIP_E2E=1 ;;
    *) echo "Okänt argument: $arg"; exit 1 ;;
  esac
done

bold() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[32m✓\033[0m %s\n" "$*"; }

START=$SECONDS

# ─── 1. Static analysis ──────────────────────────────────────────
bold "[1/5] Static analysis (typecheck + lint + deps + duplicates + knip)"
yarn typecheck && ok "typecheck"
yarn lint && ok "lint"
yarn deps:check && ok "deps:check (cycle detection)"
yarn duplicates && ok "duplicates (jscpd)"
yarn knip:report && ok "knip (dead code)"

# ─── 2. Vitest med coverage ──────────────────────────────────────
bold "[2/5] Vitest (unit + komponent)"
yarn vitest run --config tooling/config/vitest.config.ts --coverage && ok "vitest"

# ─── 3. Build (Next.js production) ───────────────────────────────
bold "[3/5] yarn build (Next.js production)"
yarn build >/dev/null && ok "next build"

# ─── 4. Demo-build (statisk export för GH Pages) ─────────────────
bold "[4/5] bash tooling/scripts/build-demo.sh (GH Pages-export)"
bash tooling/scripts/build-demo.sh >/dev/null && ok "demo-build"

# ─── 5. Round-trip e2e ───────────────────────────────────────────
if [[ $SKIP_E2E -eq 1 ]]; then
  bold "[5/5] Round-trip e2e — HOPPAR (--no-e2e)"
else
  bold "[5/5] Round-trip e2e (tier 3-stacken)"
  yarn tier3:up >/dev/null && ok "docker compose up"
  # Vänta tills web-servicen svarar
  for i in {1..15}; do
    if curl -sf -o /dev/null http://localhost:8080/ava/ 2>/dev/null; then
      ok "web redo"; break
    fi
    sleep 1
    if [[ $i -eq 15 ]]; then echo "    web svarar inte efter 15s"; exit 1; fi
  done
  yarn round-trip && ok "round-trip"
fi

# ─── Sammanställning ─────────────────────────────────────────────
bold "Klart"
ELAPSED=$((SECONDS - START))
echo "  Tid:                          ${ELAPSED}s"
echo "  Coverage-rapport:             reports/coverage/index.html"
echo "  Playwright-rapport:           reports/playwright-round-trip/index.html"
echo "  jscpd-rapport:                reports/jscpd/html/index.html"
echo
if [[ -f reports/coverage/coverage-summary.json ]]; then
  node - <<'NODE'
const s = require("./reports/coverage/coverage-summary.json").total;
const pad = (n) => String(n).padStart(7);
const row = (label, m) =>
  console.log(`  ${label.padEnd(11)} ${pad(m.pct + "%")}   (${m.covered}/${m.total})`);
console.log("  Mått        Täckning   (covered/total)");
console.log("  ─────────── ──────────────────────────");
row("Statements", s.statements);
row("Branches",   s.branches);
row("Functions",  s.functions);
row("Lines",      s.lines);
NODE
fi
echo
printf "  \033[32m✅ Allt grönt\033[0m\n"
