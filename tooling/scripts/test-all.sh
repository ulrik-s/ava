#!/usr/bin/env bash
# Kör HELA bygg-/test-stacken lokalt — speglar exakt CI (.github/workflows/ci.yml).
#
# CI har fyra jobb; detta script speglar de tre som rör bygg + test (commitlint
# körs lokalt av .husky/commit-msg vid varje commit):
#
#   1. static:  typecheck + lint --max-warnings 0 + deps:check + knip + duplicates
#   2. unit:    test:cov  (bun test --parallel=2 + lcov-coverage-golv, run-tests.ts)
#   3. e2e:     build:demo + e2e:install + demo-serve (nginx över out/) + e2e:demo
#
# Arkitekturen är server-first (Postgres + tRPC, ADR 0016); demon kör offline-
# first-kärnan på IndexedDB (ingen git/MemFs sedan #420). Git-round-trip-E2E:n är
# pensionerad (#422) — server-synken gatas av CI:s "Server-first (deploy E2E)"
# (server-first-sync-e2e mot Postgres) + "E2E (OIDC login)"; här kör vi den
# snabba browser-demo-E2E:n som regressionsskydd för demons data-load.
# Test-runner är bun:test (vitest borttaget i #92). Coverage = run-tests.ts.
#
# Lokal fälla som CI slipper (CI bygger out/ i en färsk runner):
#   - Bind-mount-staleness: build:demo gör `rm -rf out` → en redan körande
#     web-containers mount pekar på gamla inoden → nginx 404. demo-serve.sh
#     hanterar detta (bygger + remountar färsk out/).
#
# Användning:
#   bun run test:all              # hela stacken inkl. e2e (kräver docker)
#   bun run test:all --no-e2e     # hoppar e2e + docker (snabb lokal feedback)

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
fail() { printf "    \033[31m✗ %s misslyckades\033[0m\n" "$*"; exit 1; }

# Kör ett byggsteg och AVBRYT med tydligt fel om det fallerar.
#
# `cmd && ok "label"` räcker INTE under `set -e`: bash undertrycker
# exit-on-error för kommandon i en &&-lista (utom det sista), så ett fallerat
# steg passerar tyst och scriptet rapporterar "Allt grönt" med exit 0 (#143).
# run/run_quiet kollar exit-koden explicit istället.
run()       { local label="$1"; shift; "$@"            && ok "$label" || fail "$label"; }
run_quiet() { local label="$1"; shift; "$@" >/dev/null 2>&1 && ok "$label" || fail "$label"; }

START=$SECONDS

# ─── 1. Static analysis (CI-jobb: static) ────────────────────────
# Speglar ci.yml exakt: lint med --max-warnings 0 (ratchet-ventil) och knip
# som GATE (inte knip:report som är rådgivande).
bold "[1/3] Static analysis (typecheck + lint + deps + knip + duplicates)"
run "typecheck"             bun run typecheck
run "lint (--max-warnings 0)" bun run lint --max-warnings 0
run "lint:complexity-strict (#40+#199 strikt)" bun run lint:complexity-strict
run "deps:check (cykeldetektion)" bun run deps:check
run "knip (död kod — gate)" bun run knip
run "duplicates (jscpd)"    bun run duplicates

# ─── 2. Unit / komponent / integration (CI-jobb: unit) ───────────
# test:cov = run-tests.ts: bun test --parallel=2 --coverage + lcov-golv.
bold "[2/3] Unit / komponent / integration (test:cov)"
run "test:cov (bun test + coverage-golv)" bun run test:cov

# ─── 3. E2E demo (CI-jobb: Demo build + browser-demo-E2E) ────────
if [[ $SKIP_E2E -eq 1 ]]; then
  bold "[3/3] E2E (demo) — HOPPAR (--no-e2e)"
else
  bold "[3/3] E2E (browser-demo mot nginx-serverad out/)"

  # build:demo FÖRST (= CI:s "Demo build"-jobb). Producerar out/.
  run_quiet "build:demo (GH Pages-export)" bun run build:demo
  run_quiet "playwright chromium (idempotent)" bun run e2e:install

  # Servera out/ via nginx (demo-serve.sh bygger + remountar färsk out/ → inget
  # bind-mount-404), vänta in /ava/, kör browser-demo-E2E:n mot den.
  wait_for_web() {
    for i in $(seq 1 60); do
      curl -sf http://localhost:8080/ava/ 2>/dev/null | grep -q "AVA" && return 0
      sleep 2
    done
    return 1
  }

  bash tooling/scripts/demo-serve.sh >/tmp/ava-demo-serve.log 2>&1 &
  if wait_for_web; then ok "demon servar out/ på :8080/ava (ej 404)"; else fail "demon servar out/ (404?)"; fi

  AVA_DEMO_BASE_URL=http://localhost:8080/ava run "e2e:demo (fakturadokument)" bun run e2e:demo
fi

# ─── Sammanställning ─────────────────────────────────────────────
bold "Klart"
ELAPSED=$((SECONDS - START))
echo "  Tid:                          ${ELAPSED}s"
echo "  Coverage (lcov):              coverage/{a,b}/lcov.info  (golv: run-tests.ts)"
echo "  Playwright-rapport:           reports/playwright-demo/index.html"
echo "  jscpd-rapport:                reports/jscpd/jscpd-report.html"
echo
printf "  \033[32m✅ Allt grönt\033[0m\n"
