# AVA — Arkitektur

> **TL;DR**: Pure git-first. Browser är runtime. Servern är så tunn det går.
> Två deploy-mode: **demo** på GitHub Pages (read-only, auto-seedad av CI),
> **self-hosted** på en Linux-server med docker (nginx + git-http-backend).
> Ingen databas, ingen NextAuth, ingen Prisma. Allt persisteras som JSON +
> binärfiler i ett git-repo.

> **Arkitekturbeslut (ADR):** Längre fram finns en valbar Postgres-backend.
> Gränsen `IDataStore` + tRPC är designad för att vara backend-pluggbar — se
> [`docs/adr/`](./adr/). Aktuella beslut:
> - [ADR 0001](./adr/0001-pluggbar-backend-bakom-idatastore.md) — pluggbar
>   backend: Git (local-first, offline) ⟷ Postgres (server, online).
> - [ADR 0002](./adr/0002-git-konflikthantering-backend-a.md) — git-konflikt­
>   hantering i Git-backenden: last-write-wins + diskret överskrivnings-notis.
> - [ADR 0003](./adr/0003-nyckelstrategi-app-genererad-uuidv7.md) — nyckel­
>   strategi: app-genererad UUIDv7 (klient-/offline-genererad, native `uuid` i PG).
> - [ADR 0004](./adr/0004-schemaversion-och-versionsgrind.md) — `schemaVersion`
>   i `.ava/meta.json` + versionsgrind vid hydrering (datamodell-evolution).
> - [ADR 0005](./adr/0005-server-som-git-peer.md) — tunn server som git-peer:
>   integrationer + alltid-på-jobb utan att offra local-first.
> - [ADR 0006](./adr/0006-helper-https-lokal-ca.md) — helper-HTTPS via lokal CA
>   (mkcert-stil), macOS-scopat, för Safari/WKWebView (Office-add-ins).

## Tre lager

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Next.js + tRPC + DemoDataStore in-memory)       │
│  ├─ /demo: läser data från gh-pages CDN (read-only)        │
│  └─ /self-hosted: clone:ar git-repo till OPFS,             │
│                   write-back via isomorphic-git              │
└────────────────────────────────────────────────────────────┘
                          ▲ HTTPS
┌────────────────────────────────────────────────────────────┐
│  Server (val 1 av 2)                                       │
│  ├─ GitHub Pages: bara statiska filer (app + data)         │
│  └─ Linux/docker: nginx + git-http-backend + sshd          │
└────────────────────────────────────────────────────────────┘
```

## Komponenter

### Frontend (oavsett deploy-mode)
- **Next.js 16** App Router, `output: "export"` för statisk export
- **tRPC 11** in-process (anrop går genom `GitBackendRuntime` → `inProcessLink` direkt till routrar — INGEN HTTP-server). Backend väljs bakom `BackendRuntime`-seamen (Git ⟷ framtida Postgres), se [ADR 0001](./adr/0001-pluggbar-backend-bakom-idatastore.md)
- **DemoDataStore**: in-memory data-lager. Prisma-API:t (`findMany`, `create`, ...) emuleras mot vanliga JS-arrays. Write-back-callback skriver tillbaka JSON till git working copy.
- **isomorphic-git**: browser-side git clone/pull/push (pure JS)
- **OPFS (Origin Private File System)**: lokal working-copy som inte kräver fil-väljardialog
- **File System Access API** (Chrome/Edge): valbar för advanced users som vill ha repo i synlig mapp

### Self-hosted server (docker-compose)
- `web`: nginx 1.27 + git-http-backend via fcgiwrap. Servar `/ava/` statisk + `/git/firma.git` (auth_basic-gated)
- `git-ssh`: sshd för git+ssh-access (delar bare-repo med web via volym)
- Allt + git-binärerna ryms i 2 docker-imager. Inget custom server-kod-skikt.

### Demo-deploy (GitHub Pages)
- CI bygger statisk export + seedar data direkt i `out/` (samma `buildSeed()` som docker)
- Sajten serverar både app:en och data:n från samma origin
- Read-only i praktiken (ingen write-back kan ske mot CDN), men UI:n tillåter mutations som lever in-memory tills tab:en reload:ar

## Routing till runtime-skapade id:n (`__shell__`-route + `EntityLink`)

**Detta är den enda sanktionerade vägen att länka till en entitets-detaljsida.
Läs den innan du rör en länk.**

Problemet: `output: "export"` pre-renderar dynamiska rutter (`/invoices/[id]`)
**bara för build-tidens kända id:n**. Ett id som skapas i körande app (en faktura,
ett ärende …) finns inte i `generateStaticParams`. En Next-`<Link>` DIREKT till
`/invoices/<runtime-id>` hittar ingen route och kraschar (**React #418**).

Lösningen: navigera i stället till den **pre-renderade `__shell__`-routen** (som
alltid finns) och bär det riktiga id:t som query-param. Eftersom `__shell__` är
pre-renderad är det en **vanlig SPA-övergång — ingen omladdning, inget blink,
ingen #418.**

1. **`<EntityLink route id [sub]>`** (`src/lib/client/demo/entity-link.tsx`) är
   primitiven. Den renderar en Next-`<Link>` till `/<route>/__shell__/[<sub>/]?id=<id>`
   (`shellPath()` i `entity-href.ts`). SOFT-nav, ingen reload. För row-click-
   handlers: `router.push(shellPath(...))`. **Använd ALDRIG `<Link>`/`router.push`
   direkt mot `/<route>/<id>`** — det är den enda vägen till #418.
2. **`useRouteId`** (`src/lib/client/demo/use-route-id.ts`) läser id:t **reaktivt**
   via `useSearchParams().get("id")` — så även shell→shell-övergångar (samma
   pathname, ny `?id`) uppdaterar utan omladdning.
3. **`generateStaticParams`** pre-renderar `__shell__`-sentinellen per dynamisk
   route (`src/lib/client/demo/static-params.ts`).
4. **Värd-fallback (bara för direkt-URL / reload / gamla länkar)** — inte för
   in-app-klick: `out/404.html` (GH Pages, `build-demo.sh`) och nginx `try_files`
   (`nginx.conf`, self-hosted) mappar en okänd `/<route>/<id>/` till `__shell__`
   (GH Pages bär path:en i `#orig`-hashen; nginx behåller URL:en). `useRouteId`
   faller tillbaka på `#orig`-hashen resp. path:en när `?id` saknas. Detta är en
   hård laddning, men sker bara vid *ingång*, inte vid klick i appen.

`DemoBootstrap` har en **hydrerings-grind** (`mounted`-flagga): server-prerender
och klientens första render är en identisk minimal platshållare, så ingen
server/klient-hydrerings-mismatch (#418) kan uppstå — och detalj-sidornas
`useSearchParams` anropas aldrig vid prerender (slipper Suspense-kravet under
`output: export`). `MemFs-slaben` (skriv-pipelinen nedan) är **ortogonal**: den
får entitetens *data* att överleva en eventuell omladdning, men påverkar inte
routing.

**Att lägga till en ny dynamisk entity-route — fyra kopplade rörliga delar
(håll dem i synk):**
1. `generateStaticParams` i `<route>/[id]/page.tsx` → `demoStaticParams(<gitPath-prefix>)`.
   **Argumentet är `ENTITY_REGISTRY[...].gitPath`-prefixet, INTE URL-segmentet** —
   de skiljer sig för vissa routes: ärenden `demoStaticParams("matters/active")`,
   mallar `demoStaticParams(".ava/templates")`, medan URL:erna är `/matters/…`
   resp. `/templates/…/edit`. Fel prefix → noll seed-id:n pre-renderas (tyst).
2. Route-segmentet (URL) i `SHELL`-arrayen i `build-demo.sh` (404-fallbacken).
3. Samma route-segment i nginx-regex:en (`nginx.conf`, self-hosted-fallbacken).
4. Länka med `<EntityLink route id [sub]>` / `router.push(shellPath(...))`.

Kontraktet vaktas i CI av `test/unit/lib/client/demo/no-detail-link-regression.test.ts`
(failar om en `<Link>`/`router.push` mot `/<route>/<id>` smyger tillbaka) och e2e
`test/e2e/demo-invoice-document.spec.ts` (asserterar soft-nav utan omladdning).

## Data-modell

Alla entiteter lagras som JSON-rader i ett git-repo:

```
.ava/
├── organizations/<id>.json
├── users/<email>.json
└── templates/<id>.json
matters/active/<id>.json
contacts/<id>.json
matter-contacts/<id>.json
documents/<id>.json                 # metadata
documents/content/<id>.<ext>         # binärfil (PDF/DOCX)
time-entries/<id>.json
expenses/<id>.json
invoices/<id>.json
payments/<id>.json
payment-plans/<id>.json
payment-plan-reminders/<id>.json
calendar/<id>.json
tasks/<id>.json
conflict-checks/<id>.json
offices/<id>.json
manifest.json                        # för demo-läget (paths-lista)
```

`src/lib/shared/schemas/index.ts` — `ENTITY_REGISTRY` är single source of truth: zod-schema + gitPath + sourceKey per entitet.

## Skriv-pipelinen (self-hosted)

```
Router-mutation (t.ex. paymentPlan.cancel)
  ↓
DemoDataStore.transaction(tx => { tx.paymentPlans.update(...) })
  ↓
WritableDelegate.update → onMutate-callback
  ↓
fsa-write-back: skriv JSON till FSA-handle (OPFS-folder)
  ↓
window.dispatchEvent("ava:data-changed")
  ↓
AutoSync (debounced): stageAllAndCommit + pushBranch via isomorphic-git
  ↓
HTTPS POST /git/firma.git/git-receive-pack (Authorization: Basic <PAT>)
  ↓
nginx auth_basic → fcgiwrap → git-http-backend → bare-repo
```

## Auth

Demo-mode: ingen auth, read-only.

Self-hosted: nginx `auth_basic` mot htpasswd. Initial admin-PAT genereras av web-containerns entrypoint vid första uppstart (printas en gång i loggen). Vidare användare läggs till av admin via `tooling/scripts/add-user.sh`. Se [`auth.md`](./auth.md).

Commit-attribution: varje browser genererar ett Ed25519-keypar lagrat i IndexedDB. Public key persisteras på user-raden (`publicKeys`-array). Commits signeras med SSH-format så identitet kan verifieras off-server om så önskas.

## LLM (opt-in)

`/settings` har en toggle "AI (lokal LLM)". När den är på laddas en Llama-3.2-modell (~700 MB - 2 GB) ner till browserns Cache Storage första gången, via `@mlc-ai/web-llm` + WebGPU. Klassificering av dokument körs då via LLM:n med filename-heuristik som fallback. Helt offline efter första nedladdningen — modellen lämnar aldrig browsern.

## Seed-data (DRY)

`tooling/scripts/seed-data.ts` exporterar `buildSeed(opts)` — pure data-fabrik. Två konsumenter:
- `seed-firma-local.ts` → docker firma.git (default: orgId=firma-ab, currentUserId=current-user)
- `build-demo-repo.ts` → GH Pages demo (orgId=demo-firma-ab, currentUserId=u-anna)

Samma 5 users / 17 contacts / 15 matters / 40 PDF/DOCX / 7 payment plans / 25 calendar events i båda deployments. Single source of truth.

## Datamodell-evolution (schemaVersion + migrate-on-read)

Data lever i användarens git-repo, så kod-version och data-version kan skilja
sig. `.ava/meta.json` bär ett `schemaVersion` (`src/lib/shared/schema-version.ts`).
Vid hydrering kör en **versionsgrind** (repo nyare än koden → vägra starta) och
**migrate-on-read** (`src/lib/shared/schema-migrations.ts`) som lyfter äldre
rader till aktuell form innan zod-parsern ser dem. Se
[ADR 0004](./adr/0004-schemaversion-och-versionsgrind.md).

## Test-stack

- `bun test --parallel` (#92): enhets-/komponenttester. happy-dom för DOM
  (komponenter + sidor); `vi`-API:t via shim (`test/bun-compat.ts`).
  `--parallel` ger per-fil-isolering via worker-pool (motsvarar vitests
  projektisolering; `--isolate` kraschar på CI-linux).
- `playwright` för E2E round-trip (docker upp + browser-push)
- ~2224 unit/integration-tester
- TDD-fokus på pure helpers (color-palette, classify-document, search-needle, fuzzy-similarity, day-view-layout)
- Smoke-test:en `test/integration/seed-smoke.test.ts` kör varje meny-sidas tRPC-procedurer mot riktig DemoDataStore med seed-datan
