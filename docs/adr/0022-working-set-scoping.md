# ADR 0022 — Working-set-scoping (prefetch + budget) för offline-first-klienten

- **Status:** Accepterad
- **Datum:** 2026-06-17 (accepterad 2026-06-18)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** offline-first-klient, prefetch, sync (delta-pull), lokal store, lagringsbudget
- **Issue:** [#406](https://github.com/ulrik-s/ava/issues/406) (design; blockerar #418-implementationen)
- **Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md) (server-first +
  offline-first; beslut 4 "working-set-scoping" konkretiseras här),
  [ADR 0017](0017-sync-reconcile-protokoll.md) (delta-pull/cursor).
  Per-jurist-ägda ärenden (`responsibleLawyerId`): [#174](https://github.com/ulrik-s/ava/issues/174).
- **Knyter an till:** sync-bryggan (#468, `DrizzleSyncStore.pull`).

## Kontext

ADR 0016 beslut 4: hela byråns DB ska **inte** cachas på en telefon. Förhämta
användarens **working-set** (mina/bevakade ärenden, kalenderfönster, senast
öppnade + deras metadata); övrigt hämtas on-demand online; storleksbudget +
LRU-vräkning; *offline = det som finns i working-set*. Detaljerna sköts upp hit.

Working-set:en avgör två saker: (a) vad `CachingSyncDataStore` (#415) håller
lokalt för offline-läsning/skrivning, och (b) hur brett delta-pull:en (#468)
ska hämta — i dag pullar `DrizzleSyncStore.pull` **hela org:ens** change_log;
en telefon ska bara få sin working-sets delta.

## Beslut (föreslaget)

### 1. Working-set-definitionen (per användare)

**Kärna — ärenden i fokus:**
- **Mina ärenden:** `matter.responsibleLawyerId == currentUser` och
  `status == ACTIVE` (per-jurist-ägande, #174).
- **Senast öppnade:** de N senast lästa ärendena (matter-reads-spårning),
  oavsett ägare — täcker medarbetares ad-hoc-arbete.
- **Bevakade:** explicit bevakade ärenden *(öppen fråga: finns ett watch-begrepp
  i dag? annars utgår denna del tills den införs).*

**Per ärende i kärnan — barn-metadata (ej blobbar):**
- `timeEntries`, `expenses`, `documents` (metadata, **ej** fil-innehåll),
  `serviceNotes`, `invoices`, `paymentPlans`, `matterContacts`→`contacts`.

**Kalenderfönster (användarens egna):**
- `calendarEvents` med `startAt` (eller `dueAt` för deadlines) i
  `[now − Pbakåt, now + Fframåt]` (default ±N veckor). Deras ev. `matterId`
  drar in det ärendet i kärnan.

**Alltid-cachat (litet, helt):**
- `users` (org), `organization`, `offices`, `userPreferences`/`orgPreferences`
  — små referensdata, billiga att hålla kompletta.

**Utanför working-set → on-demand när online:** ärenden som varken ägs, bevakas
eller nyligen öppnats; gammal kalender; **dokument-blobbar** (hämtas vid öppning).

### 2. Storleksbudget + LRU-vräkning

- En **budget** per enhet (föreslås: antal *ärenden* i kärnan, inte bytes —
  enklare att resonera om; t.ex. default 200 ärenden med metadata). Bytes-budget
  som sekundär grind för dokument-metadata om det behövs.
- När budgeten överskrids: **vräk hela ärende-subträd** (ärendet + dess barn)
  enligt **LRU** (senast öppnad/rörd sist). Mina-ärenden + kalenderfönstret är
  "pinnade" och vräks inte.
- **Aldrig vräka en rad med en icke-uppspelad lokal mutation** (skulle tappa
  offline-arbete) — kö-status (ADR 0017) gör raden pinnad tills synkad.

### 3. Prefetch + on-demand

- **Vid login/online:** beräkna working-set:ens id-mängd (mina + senaste +
  kalender→ärenden) och förhämta kärnan + metadata.
- **Vid ärende-öppning (utanför kärnan):** hämta det ärendets subträd on-demand,
  markera läst (→ glider in i "senast öppnade"), kan vräka ett LRU-ärende.
- **Kalenderfönstret glider** med tiden (re-evaluering vid prefetch).
- **Dokument-blob:** hämtas vid öppning, cachas under egen (mindre) blob-budget.

### 4. Working-set-scopad delta-pull (effekt på #468)

`DrizzleSyncStore.pull` ska kunna **begränsas till working-set:ens ärende-mängd**
i st.f. hela org:en: pull change_log-rader vars `(entity,rowId)` hör till ett
ärende i klientens set (+ alltid-cachat). Klienten skickar sin working-set-
signatur (ärende-id-mängd eller en server-beräknad scope-token) med pull:en.

*Öppen fråga:* filtrera change_log server-side på ärende-mängden (kräver att
change_log eller en join vet `matterId` per rad) vs. pull hela org:en och
filtrera klient-side (enklare, men läcker volym till telefonen). Föreslås:
server-side-scoping, men det kräver en `matterId`-koppling i pull-frågan
(designas i #418).

## Konsekvenser

**Positivt**
- Telefon/laptop håller bara relevant data → liten lokal store, snabb, mindre
  delta-trafik.
- Pinnade mina-ärenden + kalender → juristens faktiska arbete är alltid offline.
- LRU + pin-på-pending → ingen tappad offline-skrivning, förutsägbar vräkning.
- Återanvänder kö-status (ADR 0017) för pin-beslut.

**Negativt / risker**
- Working-set-scopad pull kräver en `matterId`-dimension i delta-frågan —
  reellt schema-/query-arbete (#418); annars degraderar vi till org-bred pull +
  klient-filtrering (mer trafik).
- "Senast öppnade" + LRU kräver tillförlitlig läs-/touch-spårning (matter-reads).
- Budget-tuning (N ärenden, ±N veckor) måste mätas mot verklig byrå-data —
  defaultarna här är utgångspunkter, inte fakta (AC kräver mätning).

## Öppna frågor (till #418 / kräver din avstämning)

- **Finns ett "bevakat"-begrepp** för ärenden i dag, eller ska det införas?
- **Budget-enhet & default:** antal ärenden (föreslås ~200) vs bytes; ±N veckor
  för kalender (föreslås ±6 v). Bör mätas mot seed/verklig data.
- **Delta-pull-scoping:** server-side per ärende-mängd (kräver `matterId` i
  change_log-pull) vs klient-filtrering. Avgör #418:s svårighetsgrad.
- **Blob-budget** separat från ärende-budget — hur stor på mobil?
