# ADR 0016 — Server-first med offline-first klient (Postgres + tRPC, lokal store + sync)

- **Status:** Accepterad (mål-arkitektur — genomförande pågår)
- **Genomförande (per 2026-06-17):** Repository-sömmen (ADR 0020) klar med Drizzle-
  + in-memory-impl. ÄNNU EJ byggt: Postgres-backad HTTP-tRPC-runtime + server-verifierad
  Principal (#410), klientens `HttpDataStore` (#411) och `CachingSyncDataStore` (#415).
  Server-runtimen är fortfarande git-peer (ADR 0005). Diagrammet/flödena nedan beskriver MÅLET.
- **Datum:** 2026-06-16
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** datalager, tRPC-transport, deploy-modeller, offline-UX, demo, auth
- **Reviderar:** [ADR 0001](0001-pluggbar-backend-bakom-idatastore.md) (dual-backend
  Git⟷Postgres). Knyter an till [ADR 0009](0009-oidc-login-via-servern.md) (OIDC),
  [ADR 0013](0013-office-add-in-arkitektur.md) (tunn server äger db + tRPC-over-HTTP),
  [ADR 0015](0015-faktura-tillstandsmaskin.md) (statemaskin).

## Kontext

ADR 0001 etablerade två ömsesidigt uteslutande backends bakom `IDataStore`/tRPC:
**A — Git (local-first, exekverar i browsern via iso-git/OPFS, offline=ja, ACL=nej)**
och **B — Postgres (server-auktoritativ, offline=nej, ACL=ja)**. Den modellen har
drivit fram en växande mängd komplexitet på A-sidan — browser-iso-git, OPFS-
working-copy, MemFs-slab, projection-scheman som måste matcha mutationsutdata,
read-only-event-traps, server-runtime/peer-loop, `__shell__`-routing-shimmen.

Samtidigt har **server-koden blivit allt viktigare**: e-postutskick (dispatch-
worker), Fortnox-push, webhooks (#219), OIDC (ADR 0009), schemalagda jobb. Alla
dessa *kräver* en server och har bultats fast vid sidan av den local-first-modell
som ADR 0001 beskrev. ADR 0013 formaliserade redan att den tunna servern *äger*
databasen och exponerar tRPC-over-HTTP. Tyngdpunkten har alltså redan flyttat
server-ut; direktivet har inte hängt med.

Tre produktbeslut har klargjorts och avgör riktningen:

1. **Offline är ett hårt krav.** Jurister arbetar på flyg/tåg/i rättssal med
   opålitlig uppkoppling. Stressen är onödig och ska elimineras genom design —
   inte read-only, utan förmågan att faktiskt *arbeta* (föra tid, skriva utkast,
   läsa ärenden) offline och synka rent vid återanslutning.
2. **Data behöver inte ligga i git.** Postgres är likvärdigt eller bättre,
   förutsatt att (1) löses. Git-som-sanningskälla släpps som USP-pelare.
3. **Noll-backend-demon på GH Pages behålls** tills vidare — den är ett
   utmärkt sätt att visa systemet utan installation.

Den centrala insikten: *"server-first med kraftfull offline-cache"* och
*"local-first med sync"* löser **samma** svåra problem — att försona divergerande
state vid reconnect. Skiftet eliminerar inte det svåra; det **flyttar** det till
en mer hanterbar plats: servern blir auktoritet för konfliktlösning (validerar /
sista-skrivning-vinner) i stället för git 3-vägs-merge av strukturerad data. Och
AVA:s datamodell är mestadels **en-jurist-per-ärende** (ärendenummer per ansvarig
jurist) och **append-tung** (tidsposter, utlägg, anteckningar) → konflikter är
sällsynta → server-auktoritativ reconcile räcker.

## Beslut

Vi går **server-first** och pensionerar git-vägen (Backend A i ADR 0001):

1. **Servern är auktoritativ: Postgres + tRPC-over-HTTP.** En backend, inte två.
   Statemaskin, invarianter och (framtida) ACL enforce:as atomiskt på *ett* ställe.
2. **Varje klient är offline-first.** En lokal store (vidareutvecklad
   `DemoDataStore`, persisterad i IndexedDB) speglar användarens working-set,
   tar emot **optimistiska mutationer** i en **kö**, och **reconcilear
   server-auktoritativt** vid återanslutning.
3. **Demon = degenerat-fallet.** GH Pages-demon är *samma* klient-store med
   seed-data och **utan synk-mål**. Demon slutar vara ett divergent specialfall
   och blir "offline-läge utan server att synka mot".

`IDataStore`/tRPC-sömmen från ADR 0001 **behålls** — det är den som gör skiftet
till en omprioritering snarare än en omskrivning.

```
            ┌──────────────────────────────────────────────┐
            │  UI (Next.js)  →  tRPC-routrar (affärslogik)  │   ← oförändrat
            └───────────────────────┬──────────────────────┘
                                     │  ctx.dataStore : IDataStore   (STABILA GRÄNSEN, behålls)
                                     ▼
            ┌──────────────────────────────────────────────┐
            │  CachingSyncDataStore  (klient)               │
            │   • lokal store (DemoDataStore-kärna, IndexedDB)
            │   • optimistisk mutations-kö
            │   • reconcile mot servern                     │
            └───────────────────────┬──────────────────────┘
                          online ▲   │   ▲ offline → kö, läs ur lokal store
                                  │   ▼   │
            ┌──────────────────────────────────────────────┐
            │  HttpDataStore → tRPC-over-HTTP → SERVER       │
            │  Postgres (auktoritativ) + server-funktioner   │
            │  (mail, Fortnox, webhooks, OIDC, jobb)         │
            └──────────────────────────────────────────────┘

   Demo (GH Pages):  UI → IDataStore → lokal store (seed-data)  ── inget synk-mål ──┘
```

### De fyra besluten (med rekommenderade default-val)

| # | Beslut | Rekommendation |
|---|---|---|
| 1 | **Konfliktpolicy per entitet** | Optimistisk concurrency via `updatedAt`/`version`. Default **sista-skrivning-vinner** + servern validerar invarianter/statemaskin. Konflikt-yta i UI bara för de få strukturerade kollisionerna (t.ex. samtidig statusändring av samma faktura). Append-entiteter (tidsposter, utlägg, anteckningar) kan aldrig kollidera → bara infogas. |
| 2 | **Offline-auth** | OIDC kräver uppkoppling för *login*. Efter login cachas en session/refresh-token med **rejäl offline-grace** (t.ex. dagar) så en jurist som varit offline en hel flygning inte låses ut. Mutationer signeras med principal:en från den cachade sessionen; servern verifierar vid sync. |
| 3 | **Online-only-handlingar** | Mail-utskick (SMTP), Fortnox-push, webhooks, OIDC-refresh kan inte ske offline → de **köas** och körs vid reconnect, med tydlig UI ("skickas när du är online igen"). Ren gräns: *föra tid / skriva utkast / läsa = helt offline; skicka/boka externt = köas*. |
| 4 | **Working-set-scoping** | Hela byråns DB cachas inte på en telefon. Förhämta **användarens working-set**: mina/bevakade ärenden, kalenderfönster (±N veckor), senast öppnade, samt deras tids-/utläggs-/dokument-metadata. Övrigt hämtas on-demand när online. Offline = det som finns i working-set. Storleksbudget + LRU-vräkning. |

## Arkitektonisk regel (gränskontraktet — uppdaterat)

ADR 0001:s kontrakt gäller fortfarande, justerat för server-first:

1. **Routrar och UI går ALDRIG runt `ctx.dataStore`.** Affärslogiken är
   transport-agnostisk; den vet inte om den kör mot lokal store eller HTTP.
2. **Online/offline hanteras i `CachingSyncDataStore`**, inte i affärslogiken.
   Routrarna ser ett `IDataStore` som "alltid svarar" (lokalt först).
3. **Servern är auktoritet.** Optimistiska klient-resultat är preliminära tills
   reconcile bekräftat dem. Statemaskin/invarianter/ACL avgörs server-side.
4. **`ctx.user` är server-verifierad** i produktionsvägen (offline: cachad,
   verifieras vid sync). Demon självdeklarerar (ingen ACL att skydda).
5. **Mutationer är idempotenta och bär klient-genererat id** (UUIDv7,
   [ADR 0003](0003-nyckelstrategi-app-genererad-uuidv7.md)) så kö-uppspelning
   vid reconnect aldrig dubbel-skapar.

## Konsekvenser

**Positivt**
- Den dyraste komplexiteten pensioneras: browser-iso-git, OPFS-working-copy,
  server-runtime/peer-loop, projection-drift, read-only-event-traps.
- Server-funktioner (mail, Fortnox, webhooks, OIDC, jobb) blir förstklassiga i
  stället för fastbultade.
- **Demon blir en gratis biprodukt** av offline-klienten i stället för ett
  divergent specialfall → mindre demo-only-buggar.
- ACL/sekretess (affärsbyråers krav) faller naturligt ut server-side — inget
  separat backend-spår behövs längre.
- Offline blir *designat-in*, vilket var produktönskemålet.

**Negativt / risker**
- Det svåra försvinner inte — det flyttar till **klientens sync-motor +
  konfliktmodell**. Detta är den verkliga ingenjörsrisken. Mitigeras av
  en-ägare/append-tung datamodell (låg konfliktfrekvens) och server-auktoritativ
  reconcile (ingen 3-vägs-merge).
- **Offline-auth** kräver omsorg: token-grace för långa offline-perioder utan att
  öppna en säkerhetslucka.
- GH Pages-demon kräver fortfarande static-export-shimmen (`__shell__`/hard-nav
  för runtime-id:n) — den smärtan är Next/GH-Pages-betingad, inte datalager-
  betingad, och kvarstår men förvärras inte.
- Sunk cost i browser-iso-git pensioneras. Får inte styra framåtbeslutet.

## Migrationsspår (via IDataStore-sömmen — ingen rewrite av appen)

1. **`HttpDataStore implements IDataStore`** — tunn tRPC-over-HTTP-klient mot
   Postgres-servern (återinför det `PostgresStore` som funnits förut, nu enbart
   server-side bakom HTTP).
2. **`CachingSyncDataStore implements IDataStore`** — lindar `HttpDataStore`:
   lokal store-kärna (ur `DemoDataStore`) + IndexedDB-persistens + optimistisk
   mutations-kö + reconcile.
3. **`DemoDataStore`** behålls och blir kärnan i den lokala store:n; demon =
   `CachingSyncDataStore` utan synk-mål.
4. **Pensionera** iso-git/OPFS-adaptrar, server-runtime/peer-loop, projection-
   writer-vägen. Appen ovanför `IDataStore` rörs knappt.
5. **Fasning:** (a) inför `HttpDataStore` + server-profil; (b) bygg
   `CachingSyncDataStore` med kö + reconcile; (c) flytta demon till lokal-store-
   kärnan; (d) ta bort git-vägen när self-hosted kör på den nya stacken.

## Öppna frågor

- **Reconcile-protokollet i detalj:** delta-sync (sedan-cursor) vs full working-
  set-refresh? Per-entitet-`version` eller logisk klocka? Eget beslut/uppföljnings-ADR.
- **Konflikt-UX** för de sällsynta strukturerade kollisionerna (samtidig
  statusändring) — prompt vs banner vs server-vinner-tyst.
- **Working-set-definitionen** exakt (vilka entiteter, vilket tidsfönster,
  storleksbudget) — bör mätas mot verklig byrå-data.
- **Offline-token-livslängd** vs säkerhet — knyter an till `docs/auth.md`.
- **Migrering av befintliga git-deploys** (om några) till Postgres — engångs-import.
