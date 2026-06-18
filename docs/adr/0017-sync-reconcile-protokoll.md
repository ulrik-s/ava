# ADR 0017 — Sync/reconcile-protokoll + konfliktpolicy (offline-first klient)

- **Status:** Accepterad
- **Datum:** 2026-06-16 (accepterad 2026-06-18)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** offline-sync, datalager, konflikthantering, DB-schema, statemaskin
- **Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md) (server-first +
  offline-first klient). Knyter an till [ADR 0003](0003-nyckelstrategi-app-genererad-uuidv7.md)
  (UUIDv7), [ADR 0015](0015-faktura-tillstandsmaskin.md) (faktura-statemaskin).

## Kontext

ADR 0016 gjorde servern (Postgres + tRPC) auktoritativ och klienten offline-first
(lokal store + optimistisk mutations-kö + reconcile), men sköt upp **exakt hur**
reconcile och konflikter fungerar till denna uppföljnings-ADR. Det är det
foundationella beslutet: DB-schemat (version-kolumner, #408), mutations-kön (#413)
och reconcile-motorn (#414) beror alla på det.

Designkravet: en jurist arbetar offline (för tid, skriver utkast, ändrar ärende),
och vid återanslutning ska hennes arbete försonas med serverns tillstånd **utan
att tappa data och utan obegripliga merge-konflikter**. AVA:s datamodell är
mestadels **en-ägare-per-ärende** och **append-tung** → äkta konflikter är
sällsynta, vilket gör en server-auktoritativ modell tillräcklig (ingen 3-vägs-merge).

## Beslut

### 1. Versionering + cursor

- Varje muterbar entitet bär **`version`** (monotont heltal, börjar på 1) och
  **`updatedAt`**. Servern bumpar `version` vid varje accepterad skrivning.
- Klienten håller en **`syncCursor`** (server-tilldelad monoton sekvens — en
  global change-log-position, inte en tidsstämpel, för att undvika klock-skew).
- **Delta-sync:** klienten hämtar alla ändringar `> syncCursor` och avancerar
  cursorn. Borttag propageras via **tombstones** (mjuk `deletedAt` i change-loggen).

### 2. Mutationer

- Varje mutation bär ett **klient-genererat UUIDv7-id** (ADR 0003) och den
  **`baseVersion`** klienten observerade för raden. Id:t gör replay **idempotent**
  (server upsertar på id → ingen dubbel-skapande vid omspelning).
- Mutationer appliceras **optimistiskt lokalt direkt**, läggs i en persisterad kö,
  och spelas upp i ordning vid reconnect.

### 3. Server är auktoritet — tre konfliktklasser

Servern validerar **alltid** invarianter/statemaskin mot sitt *aktuella* tillstånd
(inte mot klientens `baseVersion`). Utfallet styrs av entitetens klass:

| Klass | Beteende vid stale skrivning | Entiteter |
|---|---|---|
| **Append** | Ingen konflikt möjlig — `create` på unikt id, idempotent upsert. | TimeEntry, Expense, Payment, PaymentPlanReminder, BillingRun, WriteOff, AccontoDeduction, Document (register), CalendarEvent |
| **LWW** (sista-skrivning-vinner) | Servern accepterar skrivningen, bumpar `version`, returnerar kanoniskt värde; klienten rebasar. | Matter (beskrivande fält), Contact, MatterContact, DocumentFolder, Task, ServiceNote (redigering), User/Org-preferenser |
| **Surface** (validera, avvisa stale) | Servern kör invariant/statemaskin mot *aktuellt* tillstånd; ogiltig övergång → **avvisa** mutationen med konflikt → klienten ytlägger för omval. | Invoice.status (ADR 0015), PaymentPlan.status, Invoice-belopp/poster efter SENT, Matter.status |

Princip: **append > LWW > surface** i fallande frekvens. De allra flesta offline-
skrivningar är append (tid/utlägg) → noll konflikt. LWW täcker beskrivande
redigeringar. Surface reserveras för det fåtal fält där en tyst överskrivning vore
fel (pengar, tillståndsövergångar).

### 4. Reconcile-sekvens (vid reconnect)

1. **Pull:** hämta deltas `> syncCursor`. Server-kanoniska rader skriver över
   lokala för dessa id:n (utom rader med icke-uppspelade lokala mutationer — de
   väntar till steg 2).
2. **Replay:** spela upp köade mutationer i ordning mot servern. Per mutation:
   - **accepterad** → ersätt lokal optimistisk rad med serverns svar, ta bort ur kön.
   - **LWW-rebase** → servern returnerar nyare kanoniskt värde; behåll det.
   - **surface-konflikt** → markera raden konflikt, lämna kvar i en *konflikt-låda*
     för användarbeslut (steg 4), blockera inte resten av kön.
3. **Advance:** sätt `syncCursor` till serverns senaste position.
4. **Konflikt-UX:** surface-konflikter visas för användaren (banner/omval). Tom i
   normalfallet (append/LWW löses automatiskt).

### 5. Statemaskin offline

Optimistiska tillståndsövergångar (t.ex. DRAFT→SENT) tillåts lokalt, men är
**preliminära**. Servern omvaliderar mot reconcilead status; en övergång som blivit
ogiltig (t.ex. fakturan hann annulleras på en annan enhet) avvisas som surface-
konflikt. Detta håller [ADR 0015] som enda auktoritet utan att låsa offline-arbete.

## Konsekvenser

**Positivt**
- Sällsynta konflikter (append-tung modell) → reconcile är nästan alltid tyst.
- Ingen 3-vägs-merge; servern är enda sanning → enkel mental modell.
- Idempotent replay (UUIDv7) → säker mot dubbel-sync/omspelning.
- Pengar/tillstånd skyddas (surface-klassen) — aldrig tyst överskrivna.

**Negativt / risker**
- Kräver `version`/`updatedAt` + en change-log/cursor server-side (#408) — schemakostnad.
- Tombstones måste städas (retention) annars växer change-loggen.
- Entitets-matrisen måste underhållas: en ny entitet utan klassning defaultar till
  **surface** (säkrast — avvisar hellre än överskriver tyst). Lint/review-vakt.
- LWW kan tappa en samtidig redigering av samma beskrivande fält (accepterat —
  en-ägare-modellen gör det sällsynt; surface-klassa fält där det vore oacceptabelt).

## Öppna frågor

- Change-log: separat tabell vs `updatedAt`-index? Retention för tombstones.
- Cursor-granularitet: global sekvens vs per-org. Per-org räcker (org = isoleringsgräns).
- Hur stort delta klienten orkar applicera i ett svep (working-set-budget, #406).
- Exakt konflikt-UX för surface-fall (#416) — banner vs modal vs server-vinner-tyst-med-logg.
