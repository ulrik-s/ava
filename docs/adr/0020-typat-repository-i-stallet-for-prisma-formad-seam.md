# ADR 0020 — Typat repository i stället för Prisma-formad `IDataStore`-söm

- **Status:** Föreslagen
- **Datum:** 2026-06-16
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** datalager-söm, routrar, PostgresStore, offline-klient, alla backends
- **Amenderar:** [ADR 0019](0019-postgres-schema-och-db-toolchain.md) (beslut 5:
  "frusen IDataStore-arg-subset + tolk" ERSÄTTS av repository-mönstret nedan).
  Bygger på [ADR 0016](0016-server-first-med-offline-first-klient.md)/[0001](0001-pluggbar-backend-bakom-idatastore.md).

## Kontext

`IDataStore` är Prisma-format: routrarna skickar **dynamiska** `where`/`include`/
`select`-objekt (787 anropsställen, 28 router-filer, ~150 distinkta frågeformer,
60 `include`). En Postgres-backend kräver då en **tolk** som översätter dessa
dynamiska objekt → SQL (ADR 0019 beslut 5). Tolken är permanent komplex och
dubbel-underhålls mot `in-memory/query-engine.ts`.

Beslut (efter utvärdering av anropsytan): **ersätt den Prisma-formade sömmen med
ett typat repository.** Varje frågeform blir en **explicit, typad metod** i stället
för ett dynamiskt arg-objekt. Det ger full typsäkerhet, tar bort tolken, och gör
varje backend-impl till vanliga typade funktioner. Priset är en bred men
parallelliserbar refaktor (~787 anropsställen).

## Beslut

1. **Söm = per-entitet repository-interfaces med explicita typade metoder.**
   I st.f. `ctx.dataStore.invoices.findFirst({ where, include })` →
   `ctx.repos.invoices.getByIdWithLedger(id)` med en typad retur (`InvoiceWithLedger`).
2. **`Repositories`-aggregat ersätter `IDataStore`** (håller alla entitets-repos +
   `transaction(fn)` som ger en transaktionell repos-vy — speglar dagens `DataStoreTx`).
3. **Två implementationer per repo:** Drizzle (server) + in-memory (browser/offline).
4. **Returtyper är explicita** (`z.infer`-baserade `XWithRelations`), inte dynamiska
   include-former → IDE-autocomplete + kompilatorn fångar fel.
5. **Den frusna arg-subseten + tolken (ADR 0019 #5) utgår** — ingen dynamisk
   tolkning behövs längre.

```
  Router:  ctx.repos.invoices.listByMatter(matterId)   ← typad metod, typad retur
                          │
            ┌─────────────┴──────────────┐
            ▼                             ▼
  DrizzleInvoiceRepo (server)   InMemoryInvoiceRepo (browser/offline)
   → Drizzle/SQL pushdown        → delegerar internt till query-engine.ts
```

### Återanvänder redan byggt arbete (ingen spilld kod)

- **`query-engine.ts` (#412) överlever** som *intern* motor: in-memory-repots
  metoder implementeras tunt ovanpå den (de slutar bara vara den exponerade sömmen).
  → in-memory-sidan blir ~150 TUNNA metoder, inte 150 nyskrivna motorer.
- **`LocalStore` (#412)** blir den interna in-memory-lagringen bakom in-memory-repot.
- **`MutationQueue`/`ReconcileEngine` (#413/#414)** jobbar på entitet/rad-nivå →
  i stort sett oförändrade.
- **`CachingSyncDataStore` (#415, ej byggt)** målar nu mot repository-interfacet
  i st.f. `IDataStore` — ingen omarbetning, bara annan målform.

### Inkrementell migrering (ingen big-bang — gröna PR:er hela vägen)

1. **Fas 1 — fundament:** `Repository`-bastyper + `Repositories`-aggregat +
   transaktions-bindning. Båda backends får en bas. Samexisterar med `IDataStore`.
2. **Fas 2 — pilot: `invoices`** (hårdast: `getById` med 11-fälts include) — bevisar
   mönstret end-to-end (router + Drizzle-impl + in-memory-impl + tester).
3. **Fas 3+ — fan-out per entitet** (parallelliserbart): migrera en entitets routrar +
   båda impls åt gången; gammal `IDataStore` lever kvar för ännu ej migrerade entiteter.
4. **Slutfas:** när alla entiteter migrerats — ta bort `IDataStore`/delegat-lagret.

### Reshaping av epic #403

- **#409** blir "repository-fundament + pilot (invoices)" i st.f. "PostgresStore-tolk".
- **#410/#411** (HTTP-tRPC-runtime / HttpDataStore) oförändrade i syfte men talar
  repository-interfacet.
- Per-entitet-migrering blir nya barn-issues under #403.

## Konsekvenser

**Positivt**
- Full typsäkerhet (autocomplete, kompilatorfel) — slut på `any`-formade delegater.
- Ingen tolk att bygga/underhålla; ingen "frusen subset"-fiktion.
- Drizzle-anrop är typade och explicita; SQL-pushdown per metod.
- Parallelliserbart per entitet; gröna inkrementella PR:er.

**Negativt / risker**
- **Stor refaktor:** ~787 anropsställen i 28 filer migreras; ~150 typade metoder ×
  2 impls (in-memory dock tunn via query-engine). Grovt 1–2 veckors arbete.
- **App-bred regressionsrisk** (rör varje router) — mitigeras av att den befintliga
  router-testsviten körs oförändrad efter varje entitets-migrering + entitet-i-taget.
- Dubbel söm under övergången (repos + IDataStore samexisterar) tills sista entiteten.

## Öppna frågor (till Fas 1)

- Namnkonvention för metoder (`getByIdWithLedger` vs `findByIdFull`) — låses i piloten.
- Hur transaktioner komponerar repos (en `tx`-bunden `Repositories`-instans).
- Var de få `aggregate`/`_count`-frågorna landar (egna metoder med typad retur).
