# AVA — Arkitektur

> **TL;DR**: **Server-first med offline-first klient** (ADR 0016). Self-hosted kör
> en tunn server (Postgres + tRPC-over-HTTP bakom oauth2-proxy); klienten är
> offline-first via en lokal store + optimistisk mutations-kö + server-auktoritativ
> reconcile. **Demon** (GitHub Pages) är samma offline-first-kärna utan synk-mål,
> seedad från CDN-JSON in i IndexedDB. Server-sidiga jobb (utskick m.m.) körs
> durabelt via pg-boss. **Git-vägen (iso-git/OPFS/MemFs) är pensionerad** (#420–#422).

> **Arkitekturbeslut (ADR):** Se [`docs/adr/`](./adr/). De som formar dagens
> arkitektur:
> - [ADR 0001](./adr/0001-pluggbar-backend-bakom-idatastore.md) — pluggbar backend
>   bakom `IDataStore`/tRPC-sömmen. **Reviderad av ADR 0016**: git local-first är
>   pensionerad; server-first (Postgres) är den enda backenden för self-hosted.
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
> - [ADR 0007](./adr/0007-kundfordringar-konstaterad-kundforlust.md) — kund­
>   fordringar: daterade händelser + konstaterad kundförlust (`WriteOff`-post,
>   livstidsvy, brygga + åldersanalys).
> - [ADR 0008](./adr/0008-secrets-valv-krypterad-fil.md) — secrets-valv:
>   krypterad fil (AES-256-GCM) i server-data-dir, master-nyckel utanför repo.
> - [ADR 0009](./adr/0009-oidc-login-via-servern.md) — self-hosted-login som
>   OIDC relying party (oauth2-proxy, BYO-IdP), aldrig egen IdP.
> - [ADR 0010](./adr/0010-regelmotor-som-idempotenta-peeracts.md) — regelmotor
>   som idempotenta, schemalagda PeerActs (server-as-git-peer, ADR 0005).
> - [ADR 0011](./adr/0011-pluggbar-ledger-connector.md) — pluggbar
>   ledger-/faktura-connector: systemoberoende fakturadomän, Fortnox är en av
>   flera bakom en port (samexistens + utbytbarhet).
> - [ADR 0012](./adr/0012-fakturanummerserier.md) — fakturanummerserier: AVA och
>   externt system (Fortnox) har var sin obrutna serie, aldrig en delad räknare
>   (lagligt enl. 17 kap. 24 § 2 ML / art. 226.2 momsdirektivet). I self-hosted
>   sätter **servern** numret vid synk (klientens är preliminärt), registret
>   `invoice_numbers` gör dubbletter omöjliga, och fakturadokumentet skapas först
>   när numret är fastställt (#1243).
> - [ADR 0013](./adr/0013-office-add-in-arkitektur.md) — Office-add-ins (Word/
>   Outlook): tunna servern äger git-db + exponerar tRPC-over-HTTP; add-ins är
>   tunna HTTP-klienter (Bearer-PAT). Web-app/demo förblir lokal-först (USP).
>   Delad task-pane-shell; #84/#72 tunna lager.
> - [ADR 0016](./adr/0016-server-first-med-offline-first-klient.md) — **server-first**
>   (Postgres + tRPC auktoritativt); varje klient är offline-first via lokal store
>   + optimistisk mutations-kö + server-auktoritativ reconcile; GH Pages-demon =
>   samma store utan synk-mål. Reviderar ADR 0001 (git-vägen pensioneras).
> - [ADR 0017](./adr/0017-sync-reconcile-protokoll.md) — sync/reconcile-protokoll +
>   konfliktpolicy: per-entitet `version` + delta-cursor, idempotent UUIDv7-mutations-
>   kö, tre konfliktklasser (append / LWW / surface-validera). Foundation för
>   ADR 0016-migreringen (#404).
> - [ADR 0019](./adr/0019-postgres-schema-och-db-toolchain.md) — Postgres-schema &
>   DB-toolchain: **Drizzle** + drizzle-kit, `uuid`-kolumner, app-nivå version-bump,
>   global `BIGSERIAL` per-org change-log, och en **frusen IDataStore-arg-subset**
>   (= query-engine.ts). zod förblir sanningskälla. Konkretiserar #408.
> - [ADR 0020](./adr/0020-typat-repository-i-stallet-for-prisma-formad-seam.md) —
>   ersätter den Prisma-formade `IDataStore`-sömmen med ett **typat repository**
>   (explicita metoder + typade returer, två impls), tar bort tolken. Amenderar
>   ADR 0019 #5. Inkrementell per-entitet-migrering; query-engine/LocalStore (#412)
>   återanvänds internt.
> - [ADR 0037](./adr/0037-harda-egen-synkmotor.md) — **härda den egna synkmotorn**:
>   kön lagrar procedur-anrop och servern kör om dem auktoritativt via samma
>   `appRouter` (mutator-modellen); logiken ligger kvar i klienten så allt fungerar
>   offline. Reviderar ADR 0017:s kö-format. Valdes framför Electric/PowerSync (#1248).

## Två lager

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Next.js + tRPC + offline-first store)            │
│  ├─ /demo: seed från gh-pages CDN → IndexedDB,             │
│  │         CachingSyncDataStore UTAN synk-mål              │
│  └─ self-hosted: CachingSyncDataStore + optimistisk        │
│                  mutations-kö → reconcile mot servern      │
└────────────────────────────────────────────────────────────┘
                          ▲ HTTPS (tRPC), self-hosted
┌────────────────────────────────────────────────────────────┐
│  Server (self-hosted)                                      │
│  ├─ oauth2-proxy (OIDC) → server-first-runtimen            │
│  ├─ tRPC-over-HTTP (appRouter) mot Postgres (Drizzle)      │
│  └─ pg-boss jobb-kö (utskick m.m.) på samma Postgres       │
│  Demo = GitHub Pages: bara statiska filer (app + seed)     │
└────────────────────────────────────────────────────────────┘
```

## Komponenter

### Frontend (klient, oavsett tier)
- **Next.js 16** App Router, `output: "export"` (statisk export — samma bundle för demo + self-hosted)
- **tRPC 11**: `appRouter` körs **in-process i klienten** mot den lokala storen
  (snabbt, offline). Self-hosted **synkar** mot servern via `TrpcSyncTransport`
  (HTTP); demon har inget synk-mål.
- **CachingSyncDataStore** (ADR 0016/0017): LocalStore-kärna + optimistisk
  mutations-kö (IndexedDB-persisterad, idempotent UUIDv7) + reconcile-motor
  (pull→apply→replay→advance). `.store` är `ctx.dataStore`. Demon kör
  `createEphemeral`-varianten utan transport.
- **IndexedDB**: klientens persistens — både datalagret (snapshot) och mutations-
  kön + genererade dok-blobbar (`generated-doc-idb`). Ersätter den gamla
  OPFS/MemFs-vägen.
- **Repository-söm** (ADR 0020): routrarna läser/skriver via `ctx.repos`
  (typade per-entitet-repos); `buildInMemoryRepositories` (klient/demo) +
  `buildDrizzleRepositories` (server). Båda måste klara samma kontrakt
  (`test/unit/server/repositories/repository-contract.test.ts`, #1249): CRUD
  med versionshöjning, mjuk borttagning, byrå ur egen kolumn, byråavgränsning
  och frysning. Kontraktet genereras ur `ENTITY_REGISTRY` — en ny entitet utan
  fixtur fäller testet.

### Self-hosted server (server-first, ADR 0016)
- `src/bin/server-first.ts` → `buildServerFirstApi`: tRPC-over-HTTP (`appRouter`)
  mot **Postgres** (Drizzle), med server-verifierad principal ur oauth2-proxy:s
  forwarded headers (ADR 0009). Sitter bakom nginx + oauth2-proxy (loopback).
- **Sync** (ADR 0017): varje accepterad skrivning loggas i `change_log`
  (BIGSERIAL per org) → delta-pull; klientens kö replay:as idempotent.
- **pg-boss jobb-kö** (#504): durabel server-sidig kö på samma Postgres (eget
  `pgboss`-schema). Claim/lease (FOR UPDATE SKIP LOCKED), retry/backoff,
  dead-letter. Handlers (t.ex. e-postutskick via smtp-sender) registreras i
  runtimen; `ctx.ports.email` köar durabelt.
- **Fulltextsökning** (#1215): dokumentjobben (`classify-document`,
  `index-document`) extraherar texten EN gång per jobb, per sida
  (`extractPages`), och skriver den till `document_pages` (genererad
  `tsvector`, 'swedish'-stemming, GIN-index). `PostgresSearchIndex` svarar på
  `document.search` (websearch_to_tsquery + ts_rank + ts_headline, org/ärende/
  typ-filter, facetter, sidnummer för bästa träff). Tabellen är **server-only**:
  ingen entitet, inget `change_log`, synkas aldrig till klienter (kan bli stor;
  klienten söker via serverns tRPC i "server"-omfånget). Mjuk delete av ett
  dokument rensar sidorna, hård delete kaskaderar.
- Schemat appliceras med `db:migrate` (versionerade SQL-migrationer); binären
  byggs med `bun build --compile` och körs som docker-image.

### Demo-deploy (GitHub Pages)
- CI bygger statisk export + seedar `out/` (`buildSeed()` → `.ava/*.json` + manifest).
- Klienten fetchar seed-filerna och bygger `DemoSource` **direkt** (ingen MemFs/
  git), hydratiserar `CachingSyncDataStore` (noSync) → IndexedDB.
- Mutationer landar i storen + **persisteras i IndexedDB** (överlever reload);
  ingen server finns att synka mot. DemoModeBanner förklarar.

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
`output: export`). Den lokala storens **IndexedDB-persistens** (skriv-pipelinen
nedan) är **ortogonal**: den får entitetens *data* att överleva en omladdning,
men påverkar inte routing.

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

## App-skalet offline (service worker, #1240)

Datan överlever ett avbrott i IndexedDB — men utan skalet (HTML + JS) går appen
inte att öppna igen. `out/sw.js` byggs av `tooling/scripts/build-service-worker.ts`
sist i `build-demo.sh` och förcachar skalet: sidorna utan id (+ RSC-payloads),
`__shell__`-sidorna, `_next/static` (utan källkartor) och favicon.

- **Strategi** (`src/lib/client/pwa/sw-routing.ts`, en allowlist): `_next/static`
  cache-first; navigeringar och RSC-payloads network-first med cache-fallback
  (4 s timeout, 5xx → cache). Allt annat — `/api`, `/git`, `/oauth2`, demo-data,
  dokument-bytes — rörs aldrig.
- **Runtime-id:n offline** får `/<route>/__shell__/` ur cachen, precis som
  Caddy/nginx skriver om dem online; okända sidor får roten.
- **Omdirigeringar cachas aldrig** — en utgången session (302 till IdP:n) får
  inte bli "sidan" offline.
- **Versioner**: cache-namnet är `ava-app-<innehållshash>`. En ny version väntar
  tills användaren klickar "Ladda om" (`PwaRegister`), och activate städar bara
  gamla `ava-app-*`.
- **E2E**: `test/e2e/demo-offline.spec.ts` (omladdning, ny flik, ärende och okänt
  id offline + kontrolltest utan service worker + versionsbytet).

## Osynkade ändringar och lokal lagring (#1241)

- **Beständig lagring**: `requestPersistentStorageOnce()` ber om
  `navigator.storage.persist()` när server-synken startar och när /settings
  öppnas. Svaret visas (`StorageStatus` under Datakälla); nekat + osynkade
  ändringar → varningen "Lokal lagring kan rensas" bredvid statuspillen.
- **Utloggning**: `signOutWithSyncCheck` synkar en sista gång och frågar om
  ändringar ändå inte nått servern (`unsyncedChangeCount()` via
  `registerServerSyncFlush`).
- **Offline-mutationer**: `makeAppQueryClient` kör `networkMode: "always"` —
  TanStacks standard pausade varje mutation så fort webbläsaren gick offline.
- **E2E**: `demo-storage-persistence.spec.ts`, `demo-offline.spec.ts` (kontakt
  offline) och `conflict/unsynced-logout.spec.ts` mot full self-hosted-stack.

## Procedur-kön (ADR 0037, #1265)

Köbara procedurer (`src/lib/shared/sync/queued-procedures.ts`, i dag
`timeEntry.create/update/delete`) köas som **anrop**, inte som färdiga rader:

- **Klienten** kör proceduren lokalt som förut (offline fungerar). In-process-
  länken ger en create ett klient-genererat UUIDv7 och kör anropet exklusivt
  (`SharedExclusiveLock`), så `CachingSyncDataStore.runQueuedProcedure` kan
  fånga dess radskrivningar som `touches` i stället för att köa dem som rader.
  Kastar proceduren rullas skrivningarna tillbaka och ingenting köas.
- **Servern** (`DrizzleProcedureReplayer`, `sync.replay`) kör samma
  `appRouter`-procedur i en transaktion som den inloggade användaren.
  Utfallet sparas i `sync_replays` (nyckel byrå + `mutationId`, #1353, samma
  transaktion) → körs högst en gång. Regelbrott (BAD_REQUEST, NOT_FOUND,
  PRECONDITION_FAILED, FORBIDDEN, CONFLICT) avvisar, liksom fel som ger samma
  utfall varje gång (zod inne i proceduren, Postgres SQLSTATE-klass 22/23);
  tekniska fel kastas och klienten försöker igen.
- **En trasig köpost blockerar inte kön** (#1353,
  `src/lib/shared/sync/sync-error.ts`, `replay-backoff.ts`). Kastar
  uppspelningen av en post klassas felet: ett deterministiskt fel (tRPC
  BAD_REQUEST/NOT_FOUND/FORBIDDEN/CONFLICT/PRECONDITION_FAILED …, 4xx, zod)
  avvisar posten direkt; ett kanske-tillfälligt fel (500, timeout, okänt)
  försöks igen med backoff — sex försök, 15 s → 4 min emellan — och avvisas
  sedan; ett fel som inte beror på posten (nätet, 401, 429, 501–503) stoppar
  kön utan att räknas. Kön spelas alltid i ordning: stannar den vid en post
  rörs inte posterna efter den och cursorn flyttas inte. En avvisad post
  hamnar bland de avvisade ändringarna nedan; en post som byggde på den avvisas
  då av servern i sin tur.
- **Svaret** bär de berörda radernas kanoniska läge (org-scopat, annars
  tombstone). Klienten ersätter sitt optimistiska läge med dem i båda utfallen.
- **Avvisade ändringar** (#1266) — från procedur-kön och radkön — sparas i
  IndexedDB (`src/lib/client/backend/rejected-changes.ts`) och visas i
  `/sync-conflicts` (länkas från synkpillret och Att bevaka) med orsak på
  svenska. **Försök igen** köar ändringen på nytt (ett anrop med nytt
  mutationId, en rad byggd på serverns version); **Kasta** låter serverns läge
  gälla. Ingen avvisad ändring försvinner tyst.
- **Procedurägda entiteter** (#1242, `src/lib/shared/sync/procedure-owned.ts`):
  ärenden, tid, utlägg och all fakturering skrivs bara av procedurkön — liksom
  administrationen (#1344): användare, byrån, kontor, byråns standardvyer och
  dokumentmallar, eftersom rollen läses ur användarraden. Servern tar inte
  emot färdiga rader för dem — en sådan radpush avvisas med ett besked (en
  manipulerad klient, eller en post som en äldre version köade). Bankgiro,
  organisationsnummer och kontoplan ändras bara av admin.
- Övriga entiteter är ren data och går via radkön, under en policy per
  entitet (#1344, `src/lib/server/sync/row-push-policy.ts`): neka som
  standard; raden och dess referenser (ärende, kontakt, dokument, mapp,
  användare …) måste höra till byrån; den som skapar en anteckning, ett
  dokument eller en jävskontroll är den pushande, och skapare och skapelsetid
  ändras aldrig; en användares preferenser skrivs bara av den användaren;
  jävskontrollens logg kan bara läggas till och hör till byrån via den som
  körde kontrollen. En ändring av en surface-entitet utan basversion avvisas.
  Server-ägda fält skrivs aldrig över.
- **Synkläget per enhet** (#1267): efter varje synk — också en misslyckad
  (#1353), annars går larmet "fast kö" aldrig — rapporterar webbläsaren sitt
  enhets-id, köns längd, den äldsta osynkade ändringen och felet som stoppade
  synken (`sync.reportDevice`, `src/lib/client/backend/sync-device-report.ts`).
  Servern sparar senaste rapporten i `sync_devices` (server-only). Admin ser
  varje enhet i Inställningar → Enheter och synk (`/sync-devices`), och Att
  bevaka larmar när en osynkad ändring är äldre än ett dygn eller en enhet
  inte synkat på en vecka (`src/lib/shared/sync/device-health.ts`). Läget
  åldras på servern även när enheten är avstängd.
- **Simuleringstester** (#1268, `test/unit/server/sync/simulation/`): flera
  klienter mot en pglite-server med seedade ändringar, avbrott och omstarter.
  Efter varje förlopp prövas att ingen ändring försvunnit tyst, att klienterna
  konvergerat, att inga fakturanummer är dubbla och att serverläget är
  detsamma som en seriell körning av det accepterade. Nattligt med fler seeds.
- **Köformatet** (#1247, `src/lib/shared/sync/queue-format.ts`): varje köpost
  (rad och anrop) stämplas med `format`. Poster utan stämpel skrevs före #1247 i
  format 1. Servern (`queue-admission.ts`) kör dagens format som det är och
  migrerar ett äldre, stött format steg för steg (`QUEUE_MIGRATIONS`). Ett för
  gammalt format avvisas med ett tydligt besked; utfallet sparas, så kön
  fastnar inte. Är klienten nyare än servern kastas ett tekniskt fel utan
  utfall: posten ligger kvar och sparas när servern har uppgraderats. Höj
  `QUEUE_FORMAT_VERSION` och lägg till migreringen när köpostens form eller en
  köbar procedurs input ändras så att äldre poster inte klarar sig.

## Data-modell

**Sanningskälla:** `src/lib/shared/schemas/index.ts` — `ENTITY_REGISTRY` (zod-schema
+ sourceKey per entitet). Drizzle-schemat (`src/lib/server/db/schema.ts`, ADR 0019)
speglar zod för Postgres.

**Persistens per tier:**
- **self-hosted:** Postgres (Drizzle-repos via `ctx.repos`, ADR 0020).
- **klient (offline-first):** IndexedDB-snapshot av `DemoSource` + mutations-kö. Snapshotet
  sparas med sin formatversion (#1269, `local-data-format.ts`): ett äldre lyfts
  steg för steg vid start, ett nyare (gammal flik, nedgradering) ger ett besked
  utan att något skrivs över. Kön migreras inte lokalt — den bär köformatet och
  servern migrerar eller avvisar med besked (#1247); inget tas bort tyst.
  `test/fixtures/local-data/` håller data i föregående releases format.
  **Flera flikar (#1346):** kön och listan över avvisade ändringar ligger i
  IndexedDB med en rad per post (`idb-entry-store.ts`: stigande nyckel = FIFO,
  unikt index på `mutationId`/id). En flik lägger till och tar bort sina egna
  poster — den skriver aldrig tillbaka sin kopia av hela listan — och läser om
  kön ur lagringen före varje reconcile. En `BroadcastChannel` per databas säger
  åt de andra flikarna att läsa om (räknare + synk). Raderna ligger i en egen
  databas (`<gammalt namn>-v2`); den gamla databasen uppgraderas aldrig, så en
  flik som fortfarande kör gammal kod kan inte blockera en versionshöjning.
  Vid varje läsning (start och före varje reconcile) flyttas den gamla listans
  poster hit om de inte redan finns eller har kvitterats (`acked`), och den
  gamla nyckeln tas bort när allt i den har flyttats. Våra anslutningar stänger
  sig vid `versionchange`, och en blockerad öppning ger upp med ett fel.
- **demo-seed (CDN):** entiteterna serialiseras till JSON-filer som GH Pages servar
  och klienten bygger `DemoSource` ur. Den fillayouten (kvar från seed-formatet):

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
document-parts/<id>.json             # delar av sammansatta dokument (#1220)
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

## Skriv- + synk-pipelinen (offline-first, ADR 0016/0017)

```
Router-mutation (t.ex. paymentPlan.cancel) — körs in-process mot lokala storen
  ↓
CachingSyncDataStore: LocalStore uppdateras OPTIMISTISKT (UI ser ändringen direkt)
  ↓ + mutationen enqueue:as (UUIDv7, idempotent) och persisteras i IndexedDB
  │
  ├─ demo:        ingen transport — kön ackumuleras men synkas aldrig
  └─ self-hosted: reconcile() → TrpcSyncTransport.push (HTTP) → servern
                    ↓
        server-first: appRouter mot Postgres bumpar version + loggar i change_log
                    ↓
        reconcile pull: delta sedan cursor → apply → replay kvarvarande kö → advance
```

Server-sidiga sido-effekter (e-postutskick m.m.) går INTE synkront i request:en —
de **köas durabelt** via pg-boss (`ctx.ports.email.send` → `email-dispatch`-kön →
handler → smtp-sender, med retry/backoff/dead-letter). Tål server-restart (#504).

## Auth

Demo: ingen auth (offline-first-kärna utan synk-mål).

Self-hosted: **OIDC relying party via oauth2-proxy** (ADR 0009) — AVA äger aldrig
en egen IdP. oauth2-proxy gat:ar åtkomsten och vidarebefordrar identiteten som
`X-Auth-Request-*`-headers; server-first-runtimen löser principalen ur dem mot
byråns allowlist (`forwarded-claims` → `server-context`). htpasswd/Basic-auth +
PAT är legacy från git-peer-eran. Se [`auth.md`](./auth.md).

## Dokumentklassificering (LLM)

Klassificering av dokument (`documentType`) körs **server-side** via jobb-kön
(#518): vid upload enqueue:as ett `classify-document`-jobb som läser dokument-
bytes, extraherar text (pdfjs/mammoth) och frågar en ollama-tjänst bakom
docker-`--profile llm` (`AVA_LLM_ENDPOINT`/`AVA_LLM_MODEL`). Fail-soft hela
vägen → filnamns-heuristik (`guessFromFilename`) om LLM:en är av/nere. Ingen
användare behöver ladda ner en LLM lokalt.

**Servern äger klassificeringen i self-hosted (#1156).** Klientens in-process-
tRPC klassar inte (`inProcessPorts`: no-op-analyzer) — dess gissning skrevs
annars över serverns svar när den synkades. Servern köar klassificeringen när
bytes:en kommer (`uploadContent`) och när en synkad dokumentrad pekar på
innehåll servern redan har (`sync.push` → `classify-new-content`; samma fil
uppladdad igen laddas aldrig upp). "Analysera" köas som anrop
(`document.analyze` i `QUEUED_PROCEDURES`) och körs om av servern. Demon
klassar som förut i klienten (filnamn). Utan LLM avgör rubrikheuristiken
(nedan) och filnamnet — ett dokument med rubriken "KALLELSE" klassas ur texten
även med ett intetsägande filnamn.

**pdfjs i den kompilerade binären (#1156, #1252).** Servern byggs med
`bun build --compile`, som varken tar med pdfjs native `DOMMatrix`-polyfill
(`@napi-rs/canvas`) eller den dynamiskt laddade worker-modulen — utan åtgärd blev
PDF-texten tom. `preparePdfjsForServer()` (`pdfjs-server-runtime.ts`) sätter en
minimal `DOMMatrix` (textutvinning renderar aldrig) och `globalThis.pdfjsWorker`
(en statisk import → workern körs i samma tråd). Båda är interna detaljer i
pdfjs, därför:

- `pdfjs-dist` är låst **exakt** i `package.json` (vaktas av
  `test/unit/tooling/pdfjs-pin.test.ts`),
- Dependabot uppgraderar den i en **egen** grupp, så binärtestet
  (`test/integration/pdf-extract-compiled.test.ts`: kompilerar en binär och läser
  en komprimerad flersidig PDF med svenska tecken) syns för just den bytningen,
- konflikt-E2E:n laddar upp en PDF i den riktiga server-first-imagen och ser den
  klassas ur texten (`test/e2e/conflict/pdf-classification.spec.ts`).

**Sammansatta dokument (#1220).** En PDF innehåller ofta flera dokument efter
varandra ("kallelse + stämning + FUP", "delgivningskvitto + dom"). Filen delas
aldrig; jobbet segmenterar sidorna till **delar** (`document_parts`: kategori +
sidintervall, `source` AUTO/MANUAL) — rubrikheuristik per sida
(`src/lib/shared/document-segmentation.ts`) + LLM bara på kandidat-startsidor
utan entydig rubrik (tak 12 anrop/dokument; utöver det bara heuristik).
`documentType` = första delens typ (bakåtkompatibelt), utom specialvärden
(Kostnadsräkning, E-post) som aldrig skrivs över. Delarna är en synkad entitet
(org via `matter_id`); användaren kan rätta en dels typ i dokumentpanelen
(→ MANUAL, bevaras vid omklassning så länge sidantalet är oförändrat). Sökningen
filtrerar/facetterar per del och visar träffens del ("Stämning, s. 5").
I server-first äger servern klassificeringen: klientens filnamnsgissning köas
bara när ingen server-jobbkö har fått bytes:en (kapabiliteten `jobs`).

Klienten (web/demo/offline) har **ingen** lokal LLM längre (den WebGPU-baserade
`@mlc-ai/web-llm`-modellen togs bort i #518 Fas 5). Demo/offline saknar server-
LLM och klassificerar därför enbart med filnamns-heuristiken.

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

## Webbläsarstöd (#1299)

De två senaste versionerna av Chrome, Edge, Firefox och Safari på desktop, samt
Safari och Chrome på iOS. Byggmålen (`browserslist` i `package.json`) är
medvetet lägre versioner — Turbopack känner inte till de nyaste och skriver då
om all modern syntax. Mappfunktionerna (File System Access API) finns bara i
Chromium. Se [`browser-support.md`](./browser-support.md).

## Test-stack

- `bun test --parallel` (#92): enhets-/komponenttester. happy-dom för DOM
  (komponenter + sidor); `vi`-API:t via shim (`test/bun-compat.ts`).
  `--parallel` ger per-fil-isolering via worker-pool (`--isolate` kraschar på CI-linux).
- **CI-jobb**: Static analysis · Unit/komponent/integration (coverage-ratchet) ·
  **Repository (Postgres)** (Drizzle-repos + sync + pg-boss mot riktig Postgres) ·
  **Server-first (deploy E2E)** (kompilerad binär i docker + push/pull-synk) ·
  **Demo build** (`build:demo`) · **E2E (OIDC login)** (oauth2-proxy + Keycloak).
- `playwright`: browser-demo-E2E (`e2e:demo`, mot nginx-serverad `out/`) + OIDC-login.
  *(Git-round-trip-E2E:n pensionerades med git-vägen, #422.)*
- Postgres-tester kör mot **pglite** (in-process WASM) lokalt och mot riktig
  Postgres i Repository-jobbet (`PG_TEST_URL`); pg-boss-testerna kräver riktig PG.
- Smoke-test:en `test/integration/seed-smoke.test.ts` kör varje meny-sidas
  tRPC-procedurer mot en seedad store.
