# ADR 0019 — Postgres-schema & DB-toolchain (Drizzle, version/change-log, IDataStore-subset)

- **Status:** Accepterad (beslut 5 — frusen arg-subset + tolk — **amenderat av [ADR 0020](0020-typat-repository-i-stallet-for-prisma-formad-seam.md)**: tolken ersätts av ett typat repository. Schema/toolchain/version/change-log (beslut 1–4) gäller fortsatt.)
- **Datum:** 2026-06-16
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** server-backend, DB-schema, migrations, reconcile, IDataStore-kontrakt
- **Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md) (server-first),
  [ADR 0017](0017-sync-reconcile-protokoll.md) (reconcile/version), [ADR 0003](0003-nyckelstrategi-app-genererad-uuidv7.md)
  (UUIDv7). Konkretiserar #408 (schema) → #409 (PostgresStore) → #410/#411.

## Kontext

ADR 0016 gjorde Postgres + tRPC till den auktoritativa backenden; Prisma togs
bort när appen blev browser-/git-first (den kunde inte köra i browsern). Nu när
DB:n lever server-side ska vi välja toolchain och spika schema-konventionerna som
reconcile (ADR 0017) kräver. `IDataStore` är Prisma-format och används tungt
(60 `include`), så hur den ytan hedras utan Prisma är kärnfrågan.

## Beslut

1. **Toolchain: Drizzle ORM + drizzle-kit.** TS-först, schema-som-kod, offline-
   genererade SQL-migrations (`drizzle-kit generate`, ingen live-DB krävs för
   #408), `drizzle-zod`-brygga, ingen codegen-daemon/binär. `pg` som driver
   (server-only). Passar tunn-server/zod-ethoset bättre än att återinföra Prisma.
2. **id-kolumner: `uuid` (native PG).** Klient-genererad UUIDv7 (ADR 0003) →
   tidsordnad B-tree-lokalitet. zod brandar fortfarande på typnivå; runtime-
   parsningen skärps till UUID vid DB-gränsen (se zod nedan).
3. **version-bump: app-nivå i PostgresStore.** `version` (int) bumpas explicit i
   varje update/upsert (en sanningskälla, testbart) — inte via DB-trigger.
4. **change-log/cursor: global `BIGSERIAL` per-org.** En `change_log`-tabell
   `(seq BIGSERIAL, org_id uuid, entity text, row_id uuid, version int, op, at)`.
   Delta-pull = rader där `seq > cursor AND org_id = :org`. Cursor = senaste sedda
   `seq`. Org = isoleringsgräns (ADR 0017 öppen fråga → per-org valt).
5. **Smalna IDataStore-arg-ytan till en dokumenterad delmängd.** PostgresStore
   stödjer EXAKT den subset som `in-memory/query-engine.ts` redan dokumenterar +
   de include/select-former routrarna använder — inte godtycklig Prisma-semantik.

### Schema-konventioner (per muterbar entitet)

- `id uuid primary key`, `created_at timestamptz`, `updated_at timestamptz`.
- `version int not null default 1` (app-bumpas).
- Mjuk delete: `deleted_at timestamptz null` (tombstone → propageras i pull).
- Org-scope: `organization_id uuid` (direkt eller via join, speglar dagens scope).
- Speglar `IDataStore`-formen + de befintliga zod-schemana i `shared/schemas/`.

### Den dokumenterade IDataStore-subseten (frysning, beslut 5)

Referens-implementationen är `src/lib/server/data-store/in-memory/query-engine.ts`
(+ delegate-lagret för relations). PostgresStore (#409) implementerar samma yta,
nedpushar till SQL:

- **Metoder:** findMany, findFirst, findUnique, findFirstOrThrow, findUniqueOrThrow,
  create, update, updateMany, upsert, delete, deleteMany, count. *(aggregate
  ingår INTE — ingen router använder den; läggs till explicit + test om det behövs.)*
- **where:** implicit equals, `contains` (insensitive), `startsWith`, `in`,
  `gte/lte/gt/lt`, `not`, `AND`, `OR`; en-stegs nästlat relations-equals
  (`matter: { organizationId }`); existens-filter `{ none: {} }` (t.ex.
  `deductedOnFinals: { none: {} }`).
- **orderBy:** `{ field: "asc"|"desc" }` eller array därav.
- **Pagination:** `skip`, `take`.
- **include/select:** nästlade relationer med `select`, `where`, `take` inom
  include, samt `_count: { select }`. (Drizzles relationella `with`-queries
  täcker detta.)

**Regel:** allt utanför subseten är ostött. Behövs en ny operator → lägg till den
i BÅDE query-engine (demo) och PostgresStore + skriv test först. En lint/review-
vakt hindrar routrar från att smyga in ostödda former.

### Hur zod-datatyperna respekteras

- **zod i `shared/schemas/` förblir sanningskällan.** Drizzle-tabellerna härleds
  från (och hålls i synk med) zod-formerna; vi genererar inte zod ur DB:n.
- **Validera vid IDataStore-gränsen:** skrivningar valideras (router-input gör
  redan det); läsningar parsas genom zod innan de lämnar PostgresStore — tolerant
  nog för att inte tappa rader ([[project-local-first-projections]]: `dateLike`
  accepterar ISO|Date, join-fält passerar).
- **`version`/`updatedAt`/`deletedAt` läggs i zod `baseFields`** (utöka det
  befintliga) så de är en del av den typade raden, inte ett DB-only-påhäng.
- **id-skärpning:** vid DB-gränsen valideras id:n som UUID (kolumntyp `uuid`);
  det generiska `idSchema` (`z.string().min(1)`) behålls för git/demo-bakåtkompat.

### Migrations + seed

- `drizzle-kit generate` → versionerade SQL-migrations i repo (granskbara,
  CODEOWNERS-skyddade som `shared/schemas/`).
- **Seed återanvänder `buildSeed()`** (enda seed-sanningskällan) → insert till PG,
  samma data som demo/docker.

## Konsekvenser

**Positivt**
- Lättviktig, zod-vänlig stack utan att återinföra borttagen Prisma.
- Frusen arg-yta → PostgresStore är bounded och testbart mot query-engine som orakel.
- version + change-log ger reconcile (ADR 0017) ett solitt fundament.
- Offline-genererade migrations → #408 kräver ingen live-DB.

**Negativt / risker**
- #409 måste skriva en args→Drizzle-tolk (Prisma-formade dynamiska objekt →
  Drizzle query builder). Bounded av subseten, men reellt arbete.
- Två schema-uttryck (zod + Drizzle-tabeller) → driftrisk; mitigeras av att zod är
  truth + en synk-vakt/test som jämför formerna.
- Browser-bundlen får ALDRIG dra in `pg`/Drizzle — dep-cruiser-regel krävs (#409).

## Öppna frågor (till #409+)

- Exakt args→Drizzle-tolk-design + var lint-vakten för subseten bor.
- `change_log`-retention/tombstone-städning.
- zod↔Drizzle synk-vakt (test som fångar drift).
