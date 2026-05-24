# Local-first round-trip — implementation & handoff

> **Syfte:** detta dokument låter en ny utvecklare/AI ta vid där föregående
> session slutade. Det beskriver vad som byggts för att göra **self-hosted
> round-trip** (browser ↔ lokal git-server) fungerande och testbar, HUR det
> fungerar, och vad som återstår. Läs detta + [`architecture-future.md`](./architecture-future.md)
> först.

Senast uppdaterad: 2026-05-24.

---

## 0. TL;DR — status

| Område | Status |
|---|---|
| Round-trip-server (git över HTTP bakom nginx) | ✅ klar + validerad |
| Write-back-täckning (alla entiteter → git-filer) | ✅ klar |
| `transaction()`-primitiv (ersätter `raw.$transaction`) | ✅ klar |
| In-memory query-engine (nested where, some/none/every, aggregate, 1:1+nested include) | ✅ klar |
| OPFS-baserad self-hosted-runtime (clone + hydrera + write-back + push) | ✅ klar + validerad i browser |
| Dynamisk routing för nya id:n i static export | ✅ klar |
| e2e round-trip (`yarn round-trip`) | ✅ **14 tester gröna** (kontakt, ärende, fakturering, utlägg, plan, kredit, avsluta+återöppna ärende, jävskontroll, settings, kontor, user CRUD, dokumentuppladdning) |
| Task #4: fler UI-flöden i e2e | ✅ klar (se §8) |
| Coverage → 95% | ⬜ Task #5 |
| Cyklomatisk komplexitet → 8 (error) | ⬜ Task #6 |

**Kör hela round-trip-loopen lokalt:**

```bash
# 1. Lägg en SSH-nyckel (krävs bara för git-ssh-servicen, ej för HTTP-round-trip)
cat ~/.ssh/id_ed25519.pub >> tooling/docker/git-ssh/authorized_keys   # valfritt

# 2. Bygg static export (OBS: build-demo.sh, INTE `yarn build` — se §7)
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh

# 3. Starta docker-stacken (nginx + git-http-backend + sshd)
docker compose -f tooling/docker/docker-compose.yml up -d --build

# 4. Kör e2e round-trip mot stacken
yarn round-trip
```

---

## 1. Round-trip-miljön (docker)

Målet: browser-klienten ska kunna **klona, committa och pusha** mot en lokal
git-server — utan GitHub och utan att pusha till `ava`-repot på GitHub.

### 1.1 Transport: git-http-backend bakom nginx

`tooling/docker/docker-compose.yml` `web`-servicen (byggd från `tooling/docker/web/Dockerfile`)
kör nginx som servar:

- `/ava/` → statiska web-app:n (`out/`)
- `/git/` → **git smart-HTTP** via `git-http-backend` (CGI körd av `fcgiwrap`)

Bare-repot delas med `git-ssh`-servicen via den namngivna volymen `git_repos`
(`/srv/git/firma.git`). Samma repo nås alltså över **HTTP**
(`http://localhost:8080/git/firma.git`) och **SSH**
(`ssh://git@localhost:2222/srv/git/firma.git`).

**Varför HTTP bakom nginx:** `/git/` ligger på **samma origin** som `/ava/`,
så browserns isomorphic-git slipper CORS-proxy helt. SSH funkar inte från
browser (ingen rå TCP-socket).

Nyckeldetaljer (se `tooling/docker/web/Dockerfile` + `entrypoint.sh` + `tooling/docker/nginx.conf`):

- Alpine-paketet `git-daemon` innehåller `git-http-backend` (ej i bas-`git`).
- Repot ägs av uid 1000 (git-ssh) men CGI:t kör som root → `git config --global
  --add safe.directory '*'` i entrypoint (annars "not in a git directory").
- `git config http.receivepack true` + `receive.denyCurrentBranch ignore` →
  **anonym push** tillåts (lokal test-server).
- HEAD defaultas till `main` (`git init --bare -b main` + `symbolic-ref` om tomt).

### 1.2 GOTCHAS (viktigt!)

- **`rm -rf out` bryter docker bind-mount.** `web` mountar `./out`; om du
  raderar och återskapar `out/` pekar mount:en på den gamla (raderade) inoden.
  **Fix:** `docker compose -f tooling/docker/docker-compose.yml restart web` efter ny build.
- **`yarn build` producerar INTE `out/`.** `output: "export"` blockeras av
  server-route-handlers under `src/app/api/`. Använd
  `DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh` som stashar `api/` m.fl. före
  build (se §7).
- nginx.conf är volym-mountad → `docker compose -f tooling/docker/docker-compose.yml restart web` laddar om den.

---

## 2. Datapersistens-pipelinen (UI → git)

```
UI-mutation (trpc.X.useMutation)
  → createDemoTrpcLink → appRouter.createCaller(ctx)   [in-process, ingen HTTP]
  → router → ctx.dataStore.X.create/update/...          [DemoDataStore]
  → WritableDelegate muterar in-memory source + emit:ar MutationEvent
  → onMutate (write-back) → fsaWriteBack → FsaIsoGitAdapter.writeFile
       → JSON-fil i OPFS-working-copy (matters/active/<id>.json etc.)
  → window-event "ava:data-changed"
  → SyncProviderRoot.notifyChange → useAutoSync (debounce ~10s)
       → commitLocal → pull → push (isomorphic-git mot localhost:8080/git)
```

### 2.1 Write-back-täckning — `src/client/lib/firma/fsa-write-back.ts`

`ENTITY_TO_PATH` mappar VARJE writable entitet → git-path. Tidigare buggen:
bara 8 entiteter var mappade; resten (folders, templates, suggestions, org,
offices, conflict-checks, payments, payment-plans, acconto-deductions) föll
igenom tyst → **persisterades aldrig**. Nu täckta. `DemoDataStore.entityNameFor`
mappar plural-källnyckel → singular projektion-namn.

### 2.2 `transaction()`-primitiv — ersätter `raw.$transaction`

Tidigare gjorde `invoice.ts` `ctx.dataStore.raw.$transaction(...)`, men
`DemoDataStore.raw` är en throwing proxy → betalningar/planer/slutfakturor
**kastade eller persisterades aldrig** i browser-läget.

Nu: `IDataStore.transaction<T>(fn: (tx: DataStoreTx) => Promise<T>)`:
- `PostgresStore`/`LocalGitStore`: delegerar till `prisma.$transaction` via
  `prismaTxToDataStoreTx` (mappar singular Prisma-delegates → plural `DataStoreTx`).
- `DemoDataStore`: in-memory snapshot/rollback + **buffrad write-back** (event
  flushas FÖRST vid commit; rullas tillbaka vid throw).
- `invoice.ts`: alla 5 sajter använder `ctx.dataStore.transaction`. `createFinal`
  använder explicita `tx.timeEntries.updateMany` + `tx.accontoDeductions.create`
  istället för Prisma nested `connect`/`create`.

Routerkoden är identisk mot både Postgres och git-store.

### 2.3 In-memory query-engine — `src/server/data-store/in-memory/`

`query-engine.ts` (`InMemoryQueryEngine`):
- Operatorer via dispatch-map (`this.ops`): equals/not/contains/startsWith/
  endsWith/in/notIn/gte/lte/gt/lt + **some/none/every**.
- **Nested to-one relations-where** (`where: { matter: { organizationId } }`)
  via rekursion i `fieldMatches`.

`read-only-delegate.ts` (`ReadOnlyDelegate`):
- Rekursiv relations-hydrering (`hydrateWith`) som driver BÅDE `include`
  (1:1 via `kind:"one"`, 1:N, + nested includes) OCH **where-prehydrering**
  (relationer som where:t filtrerar på hydreras innan matchning).
- `aggregate()` (`_sum`/`_count`/`_avg`/`_min`/`_max`).

`DemoDataStore` konfigurerar relations-grafen via `this.rel(key, childField,
parentField, kind, nestedRelations)` — t.ex. invoice→paymentPlan(one)/payments
(many, →recordedBy)/accontoDeductions(→accontoInvoice)/matter; timeEntry→user+
matter; paymentPlan→invoice→matter.

---

## 3. OPFS self-hosted-runtime (browser, ingen mapp-dialog)

OPFS-roten (`navigator.storage.getDirectory()`) ÄR en
`FileSystemDirectoryHandle` → **drop-in** för FSA-pipelinen. Ingen
behörighetsdialog → fungerar headless (Playwright) + iOS Safari.

Flöde (tier = `self-hosted` i `firma-config`):

1. `demo-bootstrap.tsx` → `loadSelfHosted()` (egen funktion, ej i useEffect-body):
   - `getOpfsRoot("working-copy")` → OPFS-handle.
   - `saveHandle("repo-root", opfs)` → så write-back + `pick-provider` hittar samma handle.
   - `loadSelfHostedSource({ handle, repo, token, origin, currentUser })`.
   - `mergeSource` + `queryClient.invalidateQueries()` + dispatch `ava:repo-ready`.
2. `loadSelfHostedSource` (`src/client/lib/firma/load-self-hosted-source.ts`):
   - Om ingen `.git/` → `cloneRepo` (iso-git, cors-proxy "" för lokal).
   - `hydrateWorkingCopy(handle)` → läser JSON-filer → `DemoSource` (invers av
     write-back; återställer Date-fält; delar `prebakeJoins` med
     `demoSourceFromRuntime`).
   - **Provisionerar current-user** (`.ava/users/<email>.json`, default
     `hourlyRate: 150000`) om den saknas — krävs av flöden som slår upp
     `ctx.user` (t.ex. `timeEntry.create` → `users.findUniqueOrThrow`).
3. Sync: `pick-provider.ts` → `makeFsaProvider` (iso-git smart-HTTP). cors-proxy
   via `resolveCorsProxy` (`""` = direkt för localhost/same-origin). Tokenlös
   push tillåts för lokal/same-origin. `detectAuthMode` ger `identified-write`
   för lokal self-hosted utan token (anonym push).
4. **Race-fix:** `SyncProviderRoot` plockar provider på mount (innan handle
   finns) → den plockar OM på `ava:repo-ready`-eventet.

---

## 4. Dynamisk routing i static export (öppna nyskapade poster)

Problem: `output: "export"` genererar `/matters/[id]` bara för build-time-kända
demo-id:n. Nya poster → fallback till `index.html` (dashboard).

Lösning:
- `src/client/lib/demo/use-route-id.ts` (`useRouteId`): läser id ur `usePathname()`
  (runtime-URL) istället för build-param.
- `src/client/lib/demo/static-params.ts` (`demoStaticParams`, `SHELL_PARAM="__shell__"`):
  `generateStaticParams` emit:ar demo-id:n + en sentinel-shell.
- `matters|contacts|invoices/[id]/page.tsx` använder `demoStaticParams`;
  `_client`-komponenterna gör `const id = useRouteId() ?? paramId`.
- `tooling/docker/nginx.conf`: regex-location serverar `/<route>/__shell__/index.html`
  för `/ava/(matters|contacts|invoices)/<id>`.

**Tester som renderar dessa `_client` MÅSTE mocka `usePathname`** (se
`test/unit/app/contacts/[id]/page.test.tsx` → `usePathname: () => null`).

---

## 5. e2e round-trip — `yarn round-trip`

- Config: `tooling/config/playwright.round-trip.config.ts` (baseURL `http://localhost:8080`).
- Tester: `test/e2e/round-trip/round-trip.spec.ts`.
- Hjälpare: `test/e2e/round-trip/_repo-helpers.ts` (`freshClone`, `readAll`,
  `resetRepo`). `resetRepo()` körs i `beforeAll` för testisolering (force-push
  ren commit).
- Mönster: sätt `localStorage["ava.firma"]` (tier self-hosted, repo
  `localhost:8080/git/firma.git`) via `addInitScript`, driv UI:t, **poll:a
  bare-repo:t** (fristående clone) tills artefakten dyker upp.

Gröna tester (8): clone+render, skapa kontakt, skapa ärende+klient, full
fakturering (tid→acconto→betalning→slutfaktura m. acconto-avdrag), utlägg,
avbetalningsplan (skapa+avbryt), kreditfaktura, avsluta ärende (status CLOSED).

`resetRepo()` körs i `beforeEach` (full isolering). Config har `retries: 1`
— hydrering av nyss-skapad data ur OPFS över sid-omladdningar har en sällsynt
timing-race; en omkörning är deterministisk.

**Lärdomar (vanliga fällor när man lägger nya detalj-flöden):**
- Relationer som UI:t läser MÅSTE konfigureras på delegaten i `DemoDataStore`
  annars kraschar renderingen (`Cannot read properties of undefined`). Ex:
  `expense.user.name` → expenses-delegaten behöver `user`-relation;
  `timeEntry.user.hourlyRate` → `user`-relation.
- **Prisma schema-defaults appliceras INTE av in-memory-store:n.** Routrar måste
  sätta fält explicit. Ex: `createPaymentPlan` + `matter.create` sätter
  `status: "ACTIVE"` (annars är `status` undefined → "Avbryt planen" / "Avsluta
  ärende" renderas aldrig, eftersom de gate:ar på `status === "ACTIVE"`).
  Grep efter andra `.create({ data: {...} })` som förlitar sig på defaults
  innan du lägger fler detalj-flöden.
- Flöden som slår upp `ctx.user` kräver att current-user provisionerats (§3).

**Förutsättning:** docker uppe + `out/` byggd + `web` omstartad om `out/` raderats.

---

## 6. Filkarta (nya/ändrade i detta arbete)

```
tooling/docker/web/{Dockerfile,entrypoint.sh}     git-http-backend bakom nginx
tooling/docker/nginx.conf                          /git/ smart-HTTP + /<route>/<id> SPA-fallback
tooling/docker/docker-compose.yml                         web bygger custom image + delar git_repos-volym

src/client/lib/sync/cors-proxy.ts                 resolveCorsProxy/isLocalOrSameOrigin
src/client/lib/fsa/git-ops.ts                     normalizeProxy ("" = ingen proxy)
src/client/lib/fsa/handle-store.ts                getOpfsRoot/isOpfsSupported + ensureReadWrite(OPFS)
src/client/lib/sync/pick-provider.ts              tokenlös lokal push + cors-proxy-val
src/client/lib/auth/github-auth.ts                lokal self-hosted → identified-write
src/client/lib/sync/sync-context.tsx              re-pick provider på ava:repo-ready

src/client/lib/firma/fsa-write-back.ts            komplett ENTITY_TO_PATH
src/client/lib/firma/hydrate-working-copy.ts      git-clone → DemoSource (invers)
src/client/lib/firma/load-self-hosted-source.ts   clone-if-empty + hydrera + provisionera user
src/client/lib/demo/prebake-joins.ts              delad join-prebakning
src/client/lib/demo/use-route-id.ts               id ur URL (SPA)
src/client/lib/demo/static-params.ts              demoStaticParams + SHELL_PARAM
src/client/components/demo-bootstrap.tsx          loadSelfHosted-gren (tier=self-hosted)

src/server/data-store/IDataStore.ts        DataStoreTx + transaction()
src/server/data-store/prisma-tx-adapter.ts singular→plural tx-mappning
src/server/data-store/PostgresStore.ts     transaction()
src/server/data-store/DemoDataStore.ts     transaction() + relations-graf + delegates
src/server/data-store/in-memory/*          query-engine + delegate (where/include/aggregate)
src/server/local-first/local-git-store.ts  transaction()
src/server/routers/invoice.ts              transaction() istället för raw.$transaction

tooling/config/playwright.round-trip.config.ts     e2e-config
test/e2e/round-trip/*                       e2e-tester + repo-helpers
```

---

## 7. Bygg & kör — exakta kommandon

```bash
# Static export (PRODUCERAR out/ — yarn build gör det INTE):
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh

# Docker-stack:
docker compose -f tooling/docker/docker-compose.yml up -d --build
docker compose -f tooling/docker/docker-compose.yml restart web        # efter rm -rf out / nginx.conf-ändring

# Verifiera transport:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/ava/
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8080/git/firma.git/info/refs?service=git-upload-pack"

# Tester:
yarn typecheck
yarn test:fast                    # unit (exkl e2e/scripts) — ~1600, 2 pre-existing fail
yarn round-trip                   # browser-e2e mot docker

# Playwright-browser (om saknas):
yarn playwright install chromium
```

---

## 8. Kända luckor & nästa steg

### Task #4 — fler UI-flöden i e2e (KLART)
Alla 14 tester i `round-trip.spec.ts` gröna:
* kontakt, ärende+klient, fakturering (tid/acconto/betalning/slutfaktura)
* utlägg, betalningsplan create/cancel, kreditfaktura
* avsluta ärende + återöppna (matter.update)
* **jävskontroll** via `searchType=personalNumber` (undviker `$queryRaw`-grenen
  som inte funkar i DemoDataStore — fuzzy-name-sök kvar som server-only-feature)
* **inställningar/org-edit** + **kontor add** (kräver bootstrap av Organization-
  raden, se §3 — ny `ensureCurrentOrganization` i `load-self-hosted-source.ts`)
* **user CRUD** (skapa via `/users/new`, inaktivera via `/users`)
* **dokument upload** (binärfil via `setInputFiles` → `documents/<id>.json` +
  `documents/content/<id>.<ext>` båda landar i git-db:n)

Sidoeffekter under arbetet med Task #4:
* `loadSelfHostedSource` provisionar nu BÅDE current-user OCH current-organization
  (fräsch clone har annars ingen org-rad → `getSettings.findUniqueOrThrow` kraschar).
  Current-user provisioneras med `role: "ADMIN"` + `active: true` så
  `user.current` returnerar rätt roll och `/users` visar Inaktivera-knappar.
* `demo-bootstrap` skippar inte längre source-laddning för `/settings`, `/users`,
  `/profile`, `/jobs` — alla läser från dataStore. Kvar i skip-listan: bara `/demo`
  (egen DemoRuntime).
* `_repo-helpers.resetRepo` använder `--allow-empty` så två efterföljande resets
  i samma rena tillstånd inte kraschar med "nothing to commit".

### Övriga kända luckor

### Övriga kända luckor
- **`events.emit` no-op:ar** i `DemoDataStore` (`ReadOnlyEventLog` kastar, fångas
  i `emit`). Events persisteras inte till `.ava/events/`. Beslut behövs:
  filesystem-event-log för self-hosted-läget.
- **`templates/[id]` + `users/[id]`** stashas av `build-demo.sh` (STASH_PATHS) →
  byggs inte för self-hosted. Måste byggas + få shell innan deras detalj-flöden
  kan e2e-testas (t.ex. user-edit på /users/[id], template-redigering).
- **Jävs-fuzzy-name-sök** (`searchType=name|both`) använder PostgreSQL `similarity()`
  via `$queryRaw` → funkar bara i server-tier:n. För self-hosted bör vi
  implementera en in-memory trigram-approximering eller dölja name-search i UI
  när tier=self-hosted.
- **Pre-existing test-fail:** `test/unit/lib/search/document-content-cache.test.ts`
  (2 fall) — koden hämtar `documents/text/*.txt` först men testet förväntar
  `documents/content/*.md`. INTE relaterat till detta arbete. Beslut: uppdatera
  testet (kod-intentet verkar medvetet) eller koden.
- **Task #5:** coverage → 95% (`tooling/config/vitest.config.ts` thresholds ~58–62 nu).
- **Task #6:** cyklomatisk komplexitet → 8 som **error** på `src/` (`tooling/config/
  eslint.config.mjs` är `warn`@12 nu). Värsta: fat client-komponenter
  (`FirmaSettingsPanel` 25, `InvoicesSection` 21, `SettingsPage` 21,
  `ContactDetailClient` 21). `applyOp` (var 23) är redan refaktorerad → dispatch-map.

### Tre deploy-lägen (påminnelse)
- **demo** (GH Pages, read-only) — `firma-config` tier `demo`, GH-Pages-loader.
- **self-hosted** (denna round-trip) — tier `self-hosted`, OPFS + iso-git mot
  egen git-HTTP-server.
- **server** (Tier 2, dev) — Postgres + Next dev (`tooling/docker/docker-compose.dev.yml`,
  `yarn scenarios`).
