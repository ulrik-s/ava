# Kvalitetsstack

Översikt över verktyg, mått och pipeline som håller AVA-kodbasen i trim.

## Verktygskedja

## Repositoriestruktur

```
ava/
├── src/                  # produktionskod
├── test/                 # all testkod (speglat src/-träd)
│   ├── unit/             # vitest enhets-/komponenttester (mirror av src/)
│   ├── scripts/          # tester för scripts/ (webdav-server m.fl.)
│   └── e2e/              # Playwright end-to-end
├── scripts/              # CLI-scripts (seed, webdav, test-full, analys)
├── prisma/               # schema + migrations
├── reports/              # **all** output (coverage, jscpd, playwright, demo-pdfs)
├── config/               # verktygskonfig (eslint, vitest, playwright,
│                         #   jscpd, knip, dependency-cruiser)
├── docs/                 # dokumentation
└── ... rotkonfig som måste ligga i roten (next, postcss, prisma, tsconfig)
```

Output-mapparna (`coverage/`, `playwright-report/`, `test-results/`, `demo-pdfs/`)
har konsoliderats till `reports/` — samlar alla CI-artefakter på ett ställe.

## Verktygskedja

| Område | Verktyg | Konfig |
|---|---|---|
| Statisk typkontroll | TypeScript `tsc --noEmit` | `tsconfig.json` |
| Lint + komplexitet | ESLint + `complexity` / `max-depth` / `max-params` | `config/eslint.config.mjs` |
| Enhetstester (Node) | Vitest | `config/vitest.config.ts` (project: `node`) |
| Komponenttester (DOM) | Vitest + jsdom + Testing Library | `config/vitest.config.ts` (project: `jsdom`), `config/vitest.setup.ts` |
| E2E-tester | Playwright (Chromium) | `config/playwright.config.ts`, `test/e2e/` |
| Kodtäckning | Vitest + V8 | `config/vitest.config.ts` `coverage`-block |
| Duplikatdetektering (DRY) | jscpd | `config/jscpd.json` |
| Arkitektur (SOLID/lager) | dependency-cruiser | `config/dependency-cruiser.cjs` |
| Död kod / oanvända exports | knip | `config/knip.json` |
| Pre-commit | husky + lint-staged | `.husky/pre-commit`, `package.json` |
| CI | GitHub Actions | `.github/workflows/ci.yml` |

## Mått och tröskelvärden

### Kodtäckning (`npm run test:cov`)

Initial baslinje-tröskel — höj efterhand som tester läggs till. Tröskeln finns i `vitest.config.ts → coverage.thresholds`:

| Mått | Tröskel (baslinje) | Mål inom 3 mån |
|---|---|---|
| Lines | 25 % | 60 % |
| Functions | 17 % | 60 % |
| Branches | 18 % | 70 % |
| Statements | 25 % | 60 % |

Aktuell baslinje (262 tester över 17 testfiler):

| Mått | Värde |
|---|---|
| Statements | 26.4 % (691/2620) |
| Branches | 20.2 % (395/1956) |
| Functions | 18.1 % (125/690) |
| Lines | 25.9 % (605/2340) |

Coverage-rapporten skrivs till `coverage/` (HTML, lcov, json-summary, text).

### Komplexitet (`npm run lint`)

| Mått | Gräns | Severity |
|---|---|---|
| Cyclomatic complexity per funktion | 12 | warn |
| Maxdjup (nested blocks) | 4 | warn |
| Rader per funktion | 100 (200 i `scripts/`) | warn |
| Parametrar per funktion | 5 | warn |
| Nested callbacks | 4 | warn |

### Duplikat (`npm run duplicates`)

| Mått | Gräns |
|---|---|
| Duplicerade kodblock | ≥ 8 rader / ≥ 80 tokens |
| Procent duplikat | < 1.5 % av kodbasen |

### Arkitektur (`npm run deps:check`)

Hårda regler (severity `error`, blockerar commit):

- **`no-circular`** — inga cirkulära imports
- **`ui-not-direct-prisma`** — `src/components/**` och `src/app/**` (utom `app/api`) får inte importera `src/server/db`
- **`ui-not-server-services`** — UI-lagret går via tRPC, inte direkt mot services
- **`no-test-imports-from-prod`** — produktionskod får inte importera testfiler
- **`no-non-package-json`** — varje `import` måste finnas i `package.json`

Mjuka regler (`warn`):

- **`no-orphans`** — moduler som ingen importerar (kandidater för bortrensning)
- **`no-deprecated-core`** — använder en deprecierad Node-modul

## Vanliga kommandon

```bash
# Snabb feedback under utveckling (< 60s, hoppar över WebDAV-integration + E2E)
npm run test:fast         # bara unit + komponenttester (≈ 8s)
npm run quality:fast      # typecheck + lint + test:fast

# Hela testsviten — startar docker compose, kör allt inkl. E2E
npm run test:full

# Full kvalitetscheck som CI kör
npm run quality           # typecheck + lint + coverage + duplicates + deps + knip

# Bara rapporter (genererar utan att fail:a)
npm run quality:report    # coverage + jscpd + dep-graph

# Specifika verktyg
npm run test:cov          # tester + coverage-rapport (HTML i coverage/)
npm run test:ui           # interaktiv vitest-UI
npm run e2e               # Playwright headless
npm run e2e:ui            # interaktiv Playwright
npm run duplicates        # jscpd, rapport i reports/jscpd/html/
npm run deps:check        # depcruise — fail:ar vid förbjudna importer
npm run deps:archi        # arkitekturdiagram (SVG, kräver Graphviz `dot`)
npm run knip              # oanvända filer/exporter
```

## Pipeline (CI)

`.github/workflows/ci.yml` definierar tre parallella jobb:

1. **`static`** — typecheck, lint, depcruise, knip, jscpd. Inga tjänster.
2. **`unit`** — vitest med coverage. Spinner upp Postgres-service.
3. **`e2e`** — Playwright Chromium mot riktig Next-server. Spinner upp Postgres + dev-stacken.

Alla jobb laddar upp sina rapporter som artefakter (coverage, jscpd, playwright-report).

## Pre-commit

`husky` + `lint-staged` kör endast på filer som faktiskt ändrats:

- `eslint --fix` på alla `.ts`/`.tsx`
- `tsc --noEmit` (snabb även på stora repos)

Tunga checks (vitest, jscpd, depcruise) körs inte i pre-commit — de kör i CI istället.

## När tröskelvärden behöver höjas

Lägg PR som höjer värdet i `vitest.config.ts` → `coverage.thresholds`. Stegvis höjning är poängen — varje testnoll-PR ska minst hålla nuvarande nivå.

## Referenser

- [Vitest coverage](https://vitest.dev/guide/coverage.html)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright](https://playwright.dev/)
- [jscpd](https://github.com/kucherenko/jscpd)
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
- [knip](https://knip.dev/)
