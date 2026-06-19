# Kvalitetsstack

Översikt över verktyg, mått och pipeline som håller AVA-kodbasen i trim.

## Verktygskedja

## Repositoriestruktur

```
ava/
├── src/
│   ├── app/             # Next.js App Router (sidor, layouts, routes)
│   ├── components/      # React-komponenter (delad UI)
│   └── lib/
│       ├── client/      # browser-only: demo/, sync/, firma/, fsa/, calendar/ …
│       ├── server/      # tRPC routers, data-store, adapters, ports, auth, events, rules
│       └── shared/      # zod-schemas + ramverks-agnostiska helpers (single source of truth)
├── test/
│   ├── unit/            # bun:test enhets-/komponenttester
│   ├── integration/     # seed-smoke + cross-router-tester
│   ├── setup/           # bun:test-preloads (happy-dom + jest-dom + cleanup)
│   ├── bun-compat.ts    # vitest→bun:test-shim (vi-API)
│   └── e2e/             # Playwright (round-trip mot docker)
├── tooling/
│   ├── config/          # eslint, playwright, knip, jscpd, dependency-cruiser
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
| Enhetstester | `bun test --isolate` | `bunfig.toml`, `test/unit/`, `test/integration/`, `test/scripts/` |
| Komponenttester (DOM) | `bun test` + happy-dom + Testing Library | `test/setup/happy-dom-register.ts`, `test/setup/preload.ts` |
| E2E-tester | Playwright (Chromium) | `tooling/config/playwright.config.ts`, `test/e2e/` |
| Kodtäckning | `bun test --coverage` (lcov) + ratchet-skript | `tooling/scripts/run-tests.ts` (`--coverage`) |
| Duplikatdetektering (DRY) | jscpd | `tooling/config/jscpd.json` |
| Bundle-size-budget | gzip-summa av klient-chunks + ratchet-skript | `tooling/scripts/check-bundle-size.ts` |
| Arkitektur (SOLID/lager) | dependency-cruiser | `tooling/config/dependency-cruiser.cjs` |
| Död kod / oanvända exports | knip | `tooling/config/knip.json` |
| Pre-commit | husky + lint-staged | `.husky/pre-commit`, `package.json` |
| CI | GitHub Actions | `.github/workflows/ci.yml` |

## Mått och tröskelvärden

### Kodtäckning (`bun run test:cov`)

Sedan vitest→bun test-migrationen (#92) körs hela sviten med
`bun test --parallel --coverage` och `tooling/scripts/run-tests.ts` summerar
lcov över `src/` och faller om täckningen sjunker under golvet. Sedan #318 körs
det i **två pass** (parallell-säkra tester parallellt + de realgit-tunga
integrationstesterna seriellt) vars lcov union-merge:as (rader exakt via DA,
funktioner per-fil-max av FNF/FNH) → eliminerar `--parallel`-flaken.

> **OBS 1:** bun:test rapporterar bara **rader + funktioner**, inte
> branches/statements (som vitest+V8 gjorde). Branch-/statement-grindarna
> är därmed borta — en medveten tradeoff vid migrationen (#92).
>
> **OBS 2:** vi kör `--parallel` (inte `--isolate`) eftersom `--isolate`
> kraschar på CI-linux (`epoll_ctl EEXIST`). `--parallel` ger korrekt
> isolering men under-rapporterar coverage något (bun aggregerar löst över
> workers) — deterministiskt, så golvet är giltigt.

Aktuell baslinje (~2334 tester över 258 filer; ratchet, strax under faktisk):

| Mått | Golv (`check-coverage.ts`) | Faktisk (lcov, src/, --parallel) |
|---|---|---|
| Lines | 76 % | ~78.0 % |
| Functions | 77 % | ~78.3 % |

Coverage-rapporten skrivs till `coverage/` (lcov).

### Komplexitet (`bun run lint`)

Alla struktur-regler är `error` (inte `warn`). CI kör `bun run lint --max-warnings 0`.

| Mått | Gräns | Nivå |
|---|---|---|
| Cyclomatic complexity per funktion | 8 | error |
| Maxdjup (nested blocks) | 4 | error |
| Rader per funktion | 100 (200 i `tooling/scripts/`) | error |
| Parametrar per funktion | 5 | error |
| Nästade callbacks | 4 | error |

#### `src/lib` + `src/app` + `src/components` strikt på complexity (#40 + #199)

`complexity@8` gäller globalt, men kunde kringgås med inline-disable eller en
post i `eslint-suppressions.json`. **`src/lib/**` (ren logik, #40) samt
`src/app/**` + `src/components/**` (UI, #199) hålls nu helt fritt från
complexity-undantag** — `bun run lint:complexity-strict`
([`check-complexity-strict.ts`](../tooling/scripts/check-complexity-strict.ts))
faller om någon återinför en complexity-disable eller -suppression i något av
dessa träd. Den körs i CI:s static-jobb. Bryt ut hjälpfunktioner/sub-komponenter
i stället (alla 23 lib-offenders refaktorerades i #40; UI-offenders i #199).

**Ingen lösare tröskel för UI.** JSX-grenar (`{cond && <X/>}`, optional chaining)
räknas mot komplexiteten precis som annan kod — lösningen är att bryta ut
sub-komponenter/hjälpare, inte ett högre tak. UI-kod är up for refactoring som
vilken annan kod som helst (#199).

#### max-lines-cap & ventil (#41)

Tidigare låg lint på `--max-warnings 45` med struktur-reglerna som `warn` —
**noll marginal** (45/45). En orelaterad ny funktion > 100 rader rödfärgade
bygget tills den bröts ut, och den delade budgeten gjorde att vilken ny warning
som helst kunde spränga taket. Den frös skulden utan att beta av den.

Nu: struktur-reglerna är `error` och dagens skuld ligger som en
**baseline** i [`eslint-suppressions.json`](../eslint-suppressions.json) i
repo-roten — ESLint 10:s inbyggda
[bulk-suppressions](https://eslint.org/docs/latest/use/suppressions). Det ger:

> **Dubbel-castar** (`x as unknown as T` / `x as any as T`) omfattas också:
> `no-restricted-syntax` är `error` (de raderar typsäkerheten helt). Den
> befintliga skulden är baselinead och avvecklas i #562 (ADR 0026); **nya**
> dubbel-castar fäller CI direkt. Använd riktiga typer i stället — branda
> drizzle-kolumner + `asId`, zod-parse extern data, eller typa seamen.


- **Ventil** — orelaterat arbete blockeras aldrig av gammal skuld. Det finns
  ingen delad warning-budget kvar att spränga; bara *nya* brott fäller bygget.
- **Hårdare ratchet** — en ny funktion > 100 rader (eller för djup/för många
  parametrar) är ett `error`, inte en warning bland 45.
- **Mekanisk nedtrappning mot 0** — när en lång funktion bryts ut kör man
  `bun run lint:prune` som tar bort dess post ur baseline:n. Filen krymper i git;
  diffen visar exakt vilken skuld som betats. Posterna får **bara** minska.

Arbetsflöde:

```bash
bun run lint:prune     # efter en refaktorering: ta bort betalda poster ur baseline
bun run lint:suppress  # ENDAST om en helt ny, oundviklig long-fn måste in (motivera i PR)
```

`bun run lint:suppress` lägger till i baseline:n och ska behandlas som en
ratchet-loosening — undvik den; bryt hellre ut funktionen. Antalet poster i
`eslint-suppressions.json` är skuldräknaren (mål: 0).

### Duplikat (`bun run duplicates`)

| Mått | Gräns |
|---|---|
| Duplicerade kodblock | ≥ 8 rader / ≥ 80 tokens |
| Procent duplikat | < 1.5 % av kodbasen |

### Bundle-size (`bun run size`, #14)

Browser-bundeln är tung (LLM opt-in, pdfjs/exceljs/mammoth, Temporal-polyfill).
[`check-bundle-size.ts`](../tooling/scripts/check-bundle-size.ts) summerar alla
statiska JS-chunks i demo-exporten (`out/`, kräver `bun run build:demo` först)
**gzip-komprimerat** och faller om summan överstiger budgeten.

| Mått | Gräns |
|---|---|
| Total klient-JS (gzip) | `BUDGET_KB` i skriptet (nu 3400 KB; baslinje ~3223 KB) |

Budgeten är en **ratchet** (samma anda som coverage/complexity): den ligger
strax över dagens siffra. Höj `BUDGET_KB` BARA när en ökning är medveten —
lazy-loada annars tunga libs. CI kör `bun run size` direkt efter `build:demo`
(återanvänder samma `out/`, ingen extra build).

### Arkitektur (`bun run deps:check`)

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

Den gamla Prisma-katalogen (`src/lib/server/db`) finns inte längre, så
`ui-not-direct-prisma`-regeln i dependency-cruiser är obsolet (kan tas bort).

Mjuka regler (`warn`):

- **`no-orphans`** — moduler som ingen importerar (kandidater för bortrensning)
- **`no-deprecated-core`** — använder en deprecierad Node-modul

## Vanliga kommandon

```bash
# Snabb feedback under utveckling (< 60s, hoppar över E2E)
bun run test:fast         # bara unit + komponenttester (~18s)
bun run quality:fast      # typecheck + lint + test:fast

# Hela testsviten — startar docker compose, kör allt inkl. E2E
bun run test:full

# Full kvalitetscheck som CI kör
bun run quality           # typecheck + lint + coverage + duplicates + deps + knip

# Bara rapporter (genererar utan att fail:a)
bun run quality:report    # coverage + jscpd + dep-graph

# Specifika verktyg
bun run test:cov          # tester + coverage-rapport (HTML i coverage/)
bun run test:ui           # interaktiv vitest-UI
bun run e2e               # Playwright headless
bun run e2e:ui            # interaktiv Playwright
bun run duplicates        # jscpd, rapport i reports/jscpd/html/
bun run deps:check        # depcruise — fail:ar vid förbjudna importer
bun run deps:archi        # arkitekturdiagram (SVG, kräver Graphviz `dot`)
bun run knip              # oanvända filer/exporter
```

## Pipeline (CI)

`.github/workflows/ci.yml` definierar fyra parallella jobb (Node 24):

1. **Commit messages** — commitlint mot Conventional Commits (endast på PR).
2. **Static analysis** — typecheck, lint (`--max-warnings 0`), depcruise, knip, jscpd. Inga tjänster.
3. **Unit / komponent / integration** — vitest med coverage mot in-memory `DemoDataStore`. Inga externa tjänster (git-first → ingen Postgres).
4. **E2E (git round-trip)** — Playwright Chromium mot docker-stacken (web + git-http-backend); startar docker, hämtar bootstrappad admin-PAT, pushar från browsern.

Jobben laddar upp sina rapporter som artefakter (coverage, jscpd, playwright-report).

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
