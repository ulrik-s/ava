#!/usr/bin/env bash
# Kör HELA test-stacken på ett bräde: typecheck → lint → unit/komponent →
# integration (WebDAV-servern) → E2E (Playwright) — och spottar ut en
# samlad kodtäckningsrapport på slutet.
#
# Lager:
#   - unit:        test/unit/lib + test/unit/server (Node, ~600 tester)
#   - komponent:   test/unit/components + test/unit/app (jsdom, ~170 tester)
#   - integration: test/scripts/webdav-server.test.ts (riktig HTTP, riktig DB,
#                  ~28 tester) — "system"-lagret
#   - e2e:         test/e2e/*.spec.ts (Playwright headless Chromium)
#
# Använd: `yarn test:all`

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }

bold "1/6  Typecheck"
yarn typecheck

bold "2/6  ESLint"
yarn lint

bold "3/6  Docker compose up (postgres, meilisearch, tika, llm)"
docker compose up -d

bold "4/6  Väntar på Postgres + synkar schema"
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U ava >/dev/null 2>&1; then
    echo "    Postgres redo."
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "    Postgres svarar inte efter 60s — avbryter."
    exit 1
  fi
done
yarn prisma db push --accept-data-loss >/dev/null

bold "5/6  Vitest med coverage (unit + komponent + integration)"
yarn vitest run --config config/vitest.config.ts --coverage

bold "6/6  Playwright E2E"
yarn playwright test --config config/playwright.config.ts

bold "Rapport"
echo "  Coverage (vitest, V8):       reports/coverage/index.html"
echo "  Coverage (lcov):             reports/coverage/lcov.info"
echo "  Playwright HTML-rapport:     reports/playwright/index.html"
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
echo "  ✅ Allt grönt — unit, komponent, integration, E2E."
