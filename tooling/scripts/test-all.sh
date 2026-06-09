#!/usr/bin/env bash
# Kör HELA bygg-/test-stacken lokalt — speglar exakt CI (.github/workflows/ci.yml).
#
# CI har fyra jobb; detta script speglar de tre som rör bygg + test (commitlint
# körs lokalt av .husky/commit-msg vid varje commit):
#
#   1. static:  typecheck + lint --max-warnings 0 + deps:check + knip + duplicates
#   2. unit:    test:cov  (bun test --parallel=2 + lcov-coverage-golv, check-coverage.ts)
#   3. e2e:     build:demo + e2e:install + docker (--wait) + round-trip
#
# Arkitekturen är pure git-modell — ingen Postgres. Test-runner är bun:test
# (vitest borttaget i #92). Coverage = coverage/lcov.info (check-coverage.ts).
#
# Två lokala fällor som CI slipper (CI bygger out/ INNAN containern startar och
# kör i en färsk runner), men som detta script hanterar explicit:
#   - Bind-mount-staleness: build:demo gör `rm -rf out` → den redan körande
#     web-containerns mount pekar på gamla inoden → nginx 404. Vi `restart web`
#     efter bygget så färsk out/ remountas (AGENTS.md).
#   - Admin-PAT: web-containern bootstrappar en slumpad PAT som round-trip behöver
#     (git-clone + browser-push) via AVA_RT_GIT_PAT. Vi extraherar den ur loggen,
#     precis som CI:s e2e-jobb.
#
# Användning:
#   bun run test:all              # hela stacken inkl. e2e (kräver docker)
#   bun run test:all --no-e2e     # hoppar e2e + docker (snabb lokal feedback)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f tooling/docker/docker-compose.yml"

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

# ─── 1. Static analysis (CI-jobb: static) ────────────────────────
# Speglar ci.yml exakt: lint med --max-warnings 0 (ratchet-ventil) och knip
# som GATE (inte knip:report som är rådgivande).
bold "[1/3] Static analysis (typecheck + lint + deps + knip + duplicates)"
bun run typecheck && ok "typecheck"
bun run lint --max-warnings 0 && ok "lint (--max-warnings 0)"
bun run deps:check && ok "deps:check (cykeldetektion)"
bun run knip && ok "knip (död kod — gate)"
bun run duplicates && ok "duplicates (jscpd)"

# ─── 2. Unit / komponent / integration (CI-jobb: unit) ───────────
# test:cov = check-coverage.ts: bun test --parallel=2 --coverage + lcov-golv.
bold "[2/3] Unit / komponent / integration (test:cov)"
bun run test:cov && ok "test:cov (bun test + coverage-golv)"

# ─── 3. E2E git round-trip (CI-jobb: e2e) ────────────────────────
if [[ $SKIP_E2E -eq 1 ]]; then
  bold "[3/3] E2E (git round-trip) — HOPPAR (--no-e2e)"
else
  bold "[3/3] E2E (git round-trip mot tier 3-stacken)"

  # build:demo FÖRST (CI bygger out/ före containern). Producerar out/.
  bun run build:demo >/dev/null && ok "build:demo (GH Pages-export)"

  bun run e2e:install >/dev/null 2>&1 && ok "playwright chromium (idempotent)"

  # Vänta tills web servar en RIKTIG out/-sida (inte nginx 404 från stale mount).
  wait_for_web() {
    for i in $(seq 1 30); do
      curl -sf http://localhost:8080/ava/ 2>/dev/null | grep -q "AVA" && return 0
      sleep 1
    done
    return 1
  }

  # Extrahera bootstrappad admin-PAT ur web-loggen. `|| true`: under
  # `set -e`+`pipefail` ger `grep | head -1` SIGPIPE på grep (head stänger pipen
  # efter rad 1) → pipeline-exit ≠ 0 trots att PAT:en lästes; vi neutraliserar.
  extract_pat() {
    local p=""
    for i in $(seq 1 30); do
      p=$($COMPOSE logs web 2>&1 \
        | grep -oE 'Admin-token:[[:space:]]+[A-Za-z0-9]{40}' | grep -oE '[A-Za-z0-9]{40}' | head -1) || true
      [ -n "$p" ] && break
      sleep 1
    done
    printf '%s' "$p"
  }

  # Primär uppstart UTAN --build → recreate:ar inte en redan körande container,
  # så bootstrap-PAT:en bevaras i loggen (snabb väg). --wait gatar på healthcheck.
  $COMPOSE up -d --wait --wait-timeout 180 >/dev/null 2>&1 && ok "docker compose up (--wait)"
  # Bind-mount-fix: remounta färsk out/ (build:demo gjorde rm -rf out → stale mount).
  $COMPOSE restart web >/dev/null 2>&1 && ok "restart web (remountar färsk out/)"
  wait_for_web && ok "web servar out/ (ej 404)" || { echo "    web servar inte out/ (404?)"; exit 1; }

  PAT=$(extract_pat)

  # Self-heal: ingen PAT i loggen (t.ex. container recreate:ad och bootstrap-raden
  # borta, men htpasswd kvar → ingen ny PAT). Tvinga fram en ren bootstrap precis
  # som CI:s färska runner: down -v nollar volymerna → entrypoint bootstrappar nytt.
  if [[ -z "$PAT" ]]; then
    bold "    ingen PAT i loggen → ren omstart (down -v) för färsk bootstrap"
    $COMPOSE down -v >/dev/null 2>&1
    $COMPOSE up -d --build --wait --wait-timeout 180 >/dev/null 2>&1 && ok "fresh docker compose up"
    wait_for_web && ok "web servar out/ (ej 404)" || { echo "    web servar inte out/ (404?)"; exit 1; }
    PAT=$(extract_pat)
  fi
  [[ -z "$PAT" ]] && { echo "    Kunde inte hämta admin-PAT ens efter ren omstart."; exit 1; }
  ok "admin-PAT extraherad (AVA_RT_GIT_PAT)"
  export AVA_RT_GIT_PAT="$PAT"

  bun run round-trip && ok "round-trip"
fi

# ─── Sammanställning ─────────────────────────────────────────────
bold "Klart"
ELAPSED=$((SECONDS - START))
echo "  Tid:                          ${ELAPSED}s"
echo "  Coverage (lcov):              coverage/lcov.info  (golv: check-coverage.ts)"
echo "  Playwright-rapport:           reports/playwright-round-trip/index.html"
echo "  jscpd-rapport:                reports/jscpd/jscpd-report.html"
echo
printf "  \033[32m✅ Allt grönt\033[0m\n"
