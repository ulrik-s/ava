# Kvalitetsstack

Översikt över verktyg, mått och pipeline som håller AVA-kodbasen i trim.

## Verktygskedja

## Repositoriestruktur

```
ava/
├── src/
│   ├── app/             # Next.js App Router (server-rendered shell-pages)
│   ├── client/          # browser-only: components/, lib/
│   ├── server/          # tRPC routers, data-store, adapters, ports
│   └── shared/          # zod-schemas (single source of truth)
├── test/
│   ├── unit/            # vitest enhets-/komponenttester
│   ├── integration/     # seed-smoke + cross-router-tester
│   └── e2e/             # Playwright (round-trip mot docker)
├── tooling/
│   ├── config/          # eslint, vitest, playwright, knip, jscpd, dependency-cruiser
│   ├── docker/          # docker-compose, nginx, web-image, optional auth-server
│   └── scripts/         # seed-data, build-demo, generate-manifest, add-user
├── reports/             # CI-artefakter (coverage, jscpd, playwright-report)
├── data/                # local-only artifacts (storage/, ej incheckat)
├── docs/                # dokumentation (denna fil + arkitektur, auth, deploy)
└── ... rotkonfig som måste ligga i roten (next, postcss, tsconfig)
```

Prisma och Postgres är borta — `prisma/`-mappen finns inte längre. All data
lever som JSON i ett git-repo (se [`architecture.md`](./architecture.md)).

## Verktygskedja

| Område | Verktyg | Konfig |
|---|---|---|
| Statisk typkontroll | TypeScript `tsc --noEmit` | `tsconfig.json` |
| Lint + komplexitet | ESLint + `complexity` / `max-depth` / `max-params` | `tooling/config/eslint.config.mjs` |
| Enhetstester (Node) | Vitest | `tooling/config/vitest.config.ts` (project: `node`) |
| Komponenttester (DOM) | Vitest + jsdom + Testing Library | `tooling/config/vitest.config.ts` (project: `jsdom`), `tooling/config/vitest.setup.ts` |
| E2E-tester | Playwright (Chromium) | `tooling/config/playwright.config.ts`, `test/e2e/` |
| Kodtäckning | Vitest + V8 | `tooling/config/vitest.config.ts` `coverage`-block |
| Duplikatdetektering (DRY) | jscpd | `tooling/config/jscpd.json` |
| Arkitektur (SOLID/lager) | dependency-cruiser | `tooling/config/dependency-cruiser.cjs` |
| Död kod / oanvända exports | knip | `tooling/config/knip.json` |
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

Aktuell baslinje (~1646 tester över 167 testfiler):

| Mått | Tröskel (vitest-config) |
|---|---|
| Statements | 68 % |
| Lines | 70 % |
| Functions | 68 % |
| Branches | 60 % |

Coverage-rapporten skrivs till `reports/coverage/` (HTML, lcov, json-summary, text).

### Komplexitet (`yarn lint`)

Alla struktur-regler är `error` (inte `warn`). CI kör `yarn lint --max-warnings 0`.

| Mått | Gräns | Nivå |
|---|---|---|
| Cyclomatic complexity per funktion | 8 | error |
| Maxdjup (nested blocks) | 4 | error |
| Rader per funktion | 100 (200 i `tooling/scripts/`) | error |
| Parametrar per funktion | 5 | error |
| Nästade callbacks | 4 | error |

#### max-lines-cap & ventil (#41)

Tidigare låg lint på `--max-warnings 45` med struktur-reglerna som `warn` —
**noll marginal** (45/45). En orelaterad ny funktion > 100 rader rödfärgade
bygget tills den bröts ut, och den delade budgeten gjorde att vilken ny warning
som helst kunde spränga taket. Den frös skulden utan att beta av den.

Nu: struktur-reglerna är `error` och dagens skuld (43 brott) ligger som en
**baseline** i [`eslint-suppressions.json`](../eslint-suppressions.json) i
repo-roten — ESLint 10:s inbyggda
[bulk-suppressions](https://eslint.org/docs/latest/use/suppressions). Det ger:

- **Ventil** — orelaterat arbete blockeras aldrig av gammal skuld. Det finns
  ingen delad warning-budget kvar att spränga; bara *nya* brott fäller bygget.
- **Hårdare ratchet** — en ny funktion > 100 rader (eller för djup/för många
  parametrar) är ett `error`, inte en warning bland 45.
- **Mekanisk nedtrappning mot 0** — när en lång funktion bryts ut kör man
  `yarn lint:prune` som tar bort dess post ur baseline:n. Filen krymper i git;
  diffen visar exakt vilken skuld som betats. Posterna får **bara** minska.

Arbetsflöde:

```bash
yarn lint:prune     # efter en refaktorering: ta bort betalda poster ur baseline
yarn lint:suppress  # ENDAST om en helt ny, oundviklig long-fn måste in (motivera i PR)
```

`yarn lint:suppress` lägger till i baseline:n och ska behandlas som en
ratchet-loosening — undvik den; bryt hellre ut funktionen. Antalet poster i
`eslint-suppressions.json` är skuldräknaren (mål: 0).

### Duplikat (`yarn duplicates`)

| Mått | Gräns |
|---|---|
| Duplicerade kodblock | ≥ 8 rader / ≥ 80 tokens |
| Procent duplikat | < 1.5 % av kodbasen |

### Arkitektur (`yarn deps:check`)

Hårda regler (severity `error`):

_Hygien_

- **`no-circular`** — inga cirkulära imports
- **`no-test-imports-from-prod`** — produktionskod får inte importera testfiler
- **`no-non-package-json`** — varje `import` måste finnas i `package.json`

_Lager- & kompositionsgränser (fitness functions)_

- **`shared-must-not-import-up`** — `src/lib/shared` får inte bero på `client/`
  eller `server/` (delad kod hör hemma neråt, inte uppåt).
- **`shared-must-be-framework-agnostic`** — `src/lib/shared` får inte importera
  `react`/`react-dom`/`next`/`@trpc`; det är ramverks-agnostisk domänkod som
  körs i alla lager.
- **`server-contracts-must-not-import-client`** — server-routrar/domänlogik får
  inte importera `client/` (undantag: git-backendens egen wiring i
  `adapters/`, `local-first/`).
- **`ui-imports-server-by-type-only`** — UI-lagret får bara `import type` från
  `server/` (tRPC-kontraktet); värde-importer endast i composition-root.
- **`no-git-cache-in-contracts`** — kontrakt-lagret + framtida Postgres-backend
  får inte importera git-backendens cache/sök-internals (gå via
  `IPorts.searchIndex`, [ADR 0001](./adr/0001-pluggbar-backend-bakom-idatastore.md)).
- **`routers-compose-via-app`** — tRPC-routrar får inte importera varandra;
  komponera top-level-routrar i `routers/_app.ts`.
- **`router-internals-private`** — en routers interna procedurgrupper i en
  subdir (t.ex. `routers/document/`) är privata: bara kompositionsfilen
  (`document.ts`) + syskon inom subdir:en får importera dem. Inga djupa
  cross-module-importer.

`src/server/db` finns inte längre (Prisma borta), så `ui-not-direct-prisma`-
regeln är obsolet.

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
