# ADR 0003 — Nyckelstrategi: app-genererad UUIDv7

- **Status:** Accepterad
- **Datum:** 2026-05-27
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** primärnycklar, schemas (`ENTITY_REGISTRY`/`idSchema`), git-fillayout, Postgres-schema, demo-generatorn, seed-data
- **Bygger på:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (pluggbar backend)

## Kontext

Vi behöver en primärnyckel-strategi som fungerar för **båda** backends bakom
`IDataStore` (git local-first ⟷ Postgres) och som är förenlig med AVA:s
kärnmodell: **id:n genereras klient-sidigt och offline**.

- I git-backenden ÄR id:t i praktiken filnamnet (`contacts/<id>.json`,
  `documents/text/<id>.txt`) och skapas i browsern utan server.
- I Postgres-backenden lagras id:t som primärnyckel.

Idag används **läsbara slug-id:n** (`m-001-vardnad`, `c-andersson`, `u-anna`).
De är seed-/demo-artefakter och skalar inte till riktig data (kollisioner,
ingen offline-generering av unika nya id:n).

Frågan: heltal (auto-increment) eller UUID — och i så fall vilken variant?

## Beslut

**Primärnycklar är app-genererade UUIDv7**, genererade i klienten/app-koden.

- **Lagring:** native `uuid`-kolumn i Postgres (16 byte, inte sträng); filnamn
  i git. Samma logiska id i båda backends.
- **Variant:** **UUIDv7** (tidsordnad — timestamp-prefix), INTE v4.
- **Genereringsplats:** app-koden (en `newId()`/`uuidv7()`-helper). Fungerar på
  alla Postgres-versioner; PG 18:s inbyggda `uuidv7()` är irrelevant eftersom
  klienten genererar id:t innan det når någon server.

### Varför inte auto-increment-heltal

Heltalssekvenser kräver **central koordinering** (en DB-sekvens) → omöjligt att
generera offline/i browsern och oförenligt med git-backenden (där id = filnamn,
skapat klient-sidigt utan server). Det skulle bryta local-first-USP:n.

### Varför UUIDv7, inte v4

Slumpmässig **v4** ger dålig insert-lokalitet i Postgres B-tree-index (random
insättningspunkter → page splits, cache-missar, fragmentering) vid stora
volymer. **v7** är tidsordnad → nästan-monotont stigande → sekventiella inserts
(som ett heltal) — bra index-prestanda **samtidigt** som global unikhet och
offline-generering behålls.

### Läsbara id:n vs UUID

Vi tappar läsbara id:n i URL:er/filnamn (`/matters/<uuid>`). Det är OK: de
**affärs-/människo-vända** identifierarna finns redan separat och behålls —
`matter.matterNumber` (`2026-0001`), `invoice`-nummer osv. UUID är ett *internt*
id; `matterNumber` förblir det användaren ser.

## Konsekvenser

**Positivt**
- Samma id-strategi för git och Postgres bakom `IDataStore` — backend-agnostiskt.
- Offline-/klient-generering utan koordinering (kärnan i local-first).
- Global unikhet → trygg merge/replikering; läcker inte radantal/ordning.
- v7 ger heltals-lik index-prestanda i Postgres.

**Negativt / att hantera**
- 16 byte/nyckel + indexstorlek (litet pris; v7 mildrar fragmenteringen).
- En `uuidv7()`-helper måste in i app-koden (`crypto.randomUUID()` är v4 →
  räcker inte; ~liten egen impl eller en liten dep).
- **Schema-ändring:** `idSchema` i `schemas/` går från slug till uuid-format;
  `ENTITY_REGISTRY.gitPath` påverkas inte i form men id-innehållet ändras.
- **Migrering:** befintlig demo-/docker-data har slug-id:n. De regenereras med
  UUID via demo-generatorn (se nedan) snarare än migreras in-place.
- Förlorad läsbarhet i URL/filnamn — mildras av kvarvarande affärsnummer.

## Påverkan på demo-generatorn (kommande arbete)

Detta spikar nyckel-strategin *innan* demo-generatorn byggs:

- Generatorn skriver via `IDataStore.create()` (ADR 0001-sömmen) med
  app-genererade id:n — fungerar likadant mot git och Postgres.
- **Determinism för fixtures:** för reproducerbara seed-id:n (tester/snapshots)
  används **deterministisk UUIDv5** (namespace + stabilt namn → samma uuid varje
  körning), medan riktig runtime-data använder UUIDv7. (Bekräftas vid bygget.)

## Öppna frågor

1. **Seed-determinism:** UUIDv5 (namnbaserad, reproducerbar) för seed vs slumpad
   v7 — bekräfta vid generator-bygget.
2. **uuidv7-impl:** egen liten helper vs dep (`uuidv7`-paketet).
3. **Migrering av befintlig demo/docker-data:** regenerera (troligt) vs
   engångs-id-omskrivning.
4. **Cross-ref-integritet:** generatorn måste tilldela id:n och wire:a
   relationer (matter → matter-contacts → documents) i beroende-ordning.
