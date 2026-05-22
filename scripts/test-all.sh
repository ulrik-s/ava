#!/usr/bin/env bash
# Kör HELA test-stacken lokalt — speglar exakt vad CI gör.
#
# Lager:
#   - static:      typecheck + lint + deps:check + duplicates + knip
#   - vitest:      unit + komponent + integration (med coverage)
#   - build:       yarn build (production Next.js)
#   - demo-build:  bash scripts/build-demo.sh (statisk export för GH Pages)
#   - e2e:         Playwright headless Chromium (kräver docker-services)
#
# Användning:
#   yarn test:all              # hela stacken inkl. e2e (kräver docker)
#   yarn test:all --no-e2e     # hoppar e2e + docker (fast lokal feedback)
#   yarn test:all --no-docker  # alias för --no-e2e
#
# Krav:
#   - Node 22 + Yarn
#   - Docker (om e2e körs)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ─── Argument-parser ─────────────────────────────────────────────
SKIP_DOCKER=0
SKIP_E2E=0
for arg in "$@"; do
  case "$arg" in
    --no-docker|--no-e2e) SKIP_E2E=1; SKIP_DOCKER=1 ;;
    *) echo "Okänt argument: $arg"; exit 1 ;;
  esac
done

bold() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[32m✓\033[0m %s\n" "$*"; }

START=$SECONDS

# ─── 1. Static analysis (CI: 'static' job) ───────────────────────
bold "[1/7] Static analysis (typecheck + lint + deps + duplicates + knip)"
yarn typecheck && ok "typecheck"
yarn lint && ok "lint"
yarn deps:check && ok "deps:check (cycle detection)"
yarn duplicates && ok "duplicates (jscpd)"
yarn knip:report && ok "knip (dead code)"

# ─── 2. Build (Next.js production) ───────────────────────────────
bold "[2/7] yarn build (Next.js production)"
yarn build >/dev/null && ok "next build"

# ─── 3. Demo-build (statisk export för GH Pages) ─────────────────
bold "[3/7] bash scripts/build-demo.sh (GH Pages-export)"
bash scripts/build-demo.sh >/dev/null && ok "demo-build"

# ─── 4. Docker services för integration + e2e ────────────────────
if [[ $SKIP_DOCKER -eq 1 ]]; then
  bold "[4/7] Docker services — HOPPAR (--no-docker)"
else
  bold "[4/7] Docker services (postgres, meilisearch, tika, llm)"
  docker compose up -d
  for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U ava >/dev/null 2>&1; then
      ok "postgres redo"
      break
    fi
    sleep 2
    if [[ $i -eq 30 ]]; then
      echo "    Postgres svarar inte efter 60s — avbryter."
      exit 1
    fi
  done
  yarn prisma db push --accept-data-loss >/dev/null && ok "schema synkat"
fi

# ─── 5. Vitest med coverage ──────────────────────────────────────
bold "[5/7] Vitest (unit + komponent + integration)"
yarn vitest run --config config/vitest.config.ts --coverage && ok "vitest"

# ─── 6. Playwright e2e ───────────────────────────────────────────
if [[ $SKIP_E2E -eq 1 ]]; then
  bold "[6/7] Playwright e2e — HOPPAR (--no-e2e)"
else
  bold "[6/7] Playwright e2e"
  yarn playwright test --config config/playwright.config.ts && ok "e2e"
fi

# ─── 7. Sammanställning ──────────────────────────────────────────
bold "[7/7] Klart"
ELAPSED=$((SECONDS - START))
echo "  Tid:                          ${ELAPSED}s"
echo "  Coverage-rapport:             reports/coverage/index.html"
echo "  Playwright-rapport:           reports/playwright/index.html"
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
