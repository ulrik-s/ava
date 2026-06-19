# ADR 0026 — Branda persistens-gränsen (typad delegate + branded kolumner)

Status: Accepterad — Fas 1 + Fas 2 implementerade (2026-06-19). Residual (permissiv
`WhereInput` + `string`-repo-id-params) medvetet behållen — se Konsekvenser.

## Kontext

Arkitekturgenomgången (jun 2026) visade att kodbasen är starkt typad (`strict`
+ `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`, 0 `@ts-ignore`),
men hade två kvarvarande typsvagheter vid persistens-gränsen:

1. **Den sista explicit `any`:n** — `IDataStore.Delegate` hade `args: any` på
   query-metoderna (findUnique/findFirst/findMany/count/delete/aggregate) +
   `JoinedRelations`-fält som `any` + `$queryRaw: any`. Det var det ENDA
   `no-explicit-any`-undantaget i src (en dokumenterad eslint-disable).
2. **~105 `as unknown as`** kvar efter quick-wins #557/#559/#561 (213→105),
   varav ~85 vid drizzle-ORM-kanten: `db.select()` ger `id: string`, domänen
   vill `MatterId` → raden assertas (centraliserat i `asRow`/`asRows`, #560).

## Beslut

**Branda persistens-gränsen i två faser.** Mål: noll explicit `any` + minimera
`as unknown as` i repository/datastore-lagret.

### Fas 1 — typa delegate-query-input (DENNA PR, #562)

- `FindArgs<Row>` / `WhereInput<Row>` / `OrderByInput<Row>` / `AggregateArgs`
  ersätter `args: any` på alla delegate-metoder.
- `JoinedRelations`-fält `any` → `unknown` (caller narrowar/castar till sin
  `WithRelations`-typ — branded id:n bevaras eftersom fälten är optional).
- `$queryRaw` borttagen (oanvänd). `Delegate<Row = Record<string, unknown>>`.
- **eslint-disable borttagen** → `no-explicit-any` är nu `error` ÖVERALLT i src,
  utan undantag. **Noll explicit `any` i kodbasen.**

`WhereInput<Row>` är medvetet **permissiv**: fält-nycklar hintas mot `Row`, men
värdena är `unknown` (+ `Record<string, unknown>`-escape för relations-filter),
eftersom (a) repos:en skickar OBRANDADE id-strängar (metod-params är `string`)
och (b) relations-filter (`{ matter: { organizationId } }`) refererar typer
delegaten inte känner generiskt. Query-engine:n validerar formen i runtime.
Striktare per-entitet-where skulle kräva Prisma-stil GENERERADE typer per
entitet (100+ rader/entitet) — ej motiverat; det är inte en `any`, bara löst.

Fallout var liten + kontenerad: in-memory-delegate-klasserna pekades om till
`FindArgs<T>`, och 4 projektion-castar blev `as unknown as` (resultatet är nu
`Joined<Record<string, unknown>>` i st.f. `Joined<any>`). Net `as unknown as`:
105 → 109 — en medveten avvägning (eliminera `any` > 4 gräns-castar).

### Fas 2 — branda drizzle-kolumnerna (IMPLEMENTERAD, 2026-06-19)

`.$type<XId>()` ligger nu på **106 kolumner** (id/FK + enum/jsonb) i
`db/schema.ts` så `db.select()` bär branded id:n. Den koordinerade per-entitet/
lager-PR-serien genomfördes (PR #581 + #585–#592): alla ~27 entiteter brandade,
`asRow`/`asRows` borttagna, och de relations-laddade `db.query…with{}`-
inferenserna matchar de handskrivna `WithRelations`-typerna utan cast.

Den befarade kaskaden (probe: `eq(matters.id, stringParam)` slutar matcha)
hanteras vid **query-gränsen i repo-lagret** med en enda `asId<B>(s)`-cast
(`eq(col, asId<"MatterId">(id))`) i stället för att branda varje repo-metods
id-parameter. Det **lokaliserar** brandingen till repo:n — routrar och anropare
fortsätter skicka rena `string`-id:n (som de får ur tRPC-input) utan att behöva
`asId` på 27+ ställen. `asId` är en enkel cast (inte `as unknown as`) och fälls
inte av double-cast-regeln.

Resultat: **noll `as unknown as` i `src/` + `tooling/`** (kvarvarande grep-
träffar är doc-kommentarer). Borttaget via PR #585–#595. På köpet hittades en
latent bugg som ett cast dolde: dokumentstorlek visades tom i fil-listan
(`fileSize` vs `sizeBytes`, #588, fixad i #589).

### Fas 3 — router-`where`-ytan (utfasad, ej egen insats)

Epikens farhåga om "300+ router-anropsställen med `where:`" är **inaktuell**:
repository-migreringen (ADR 0020) flyttade routrarna till typade `ctx.repos`,
så `where:` används nu bara internt i repo-lagret (~27 ställen) + EN router
(`user.ts`). Den otypade query-ytan är därmed en **kontenerad intern söm**, inte
en spridd risk över hela router-lagret.

## Konsekvenser

- **Noll explicit `any`** i src — `no-explicit-any: error` utan undantag (ratchet
  låst i topp).
- **Noll `as unknown as` i `src/` + `tooling/`** — `no-restricted-syntax`-regeln
  (error, CI + lokalt) + `eslint-suppressions.json`-baseline blockerar NYA
  double-casts överallt (inkl. test). Net `as unknown as`: 213 → 109 (Fas 1) → 0
  riktiga i src/tooling (Fas 2, PR #585–#595).
- 106 brandade kolumner i `db/schema.ts`; `db.query…with{}`-inferenserna matchar
  domän-typerna utan cast.

### Medvetet behållen residual (beslut)

Två lösheter behålls AVSIKTLIGT — de är inte `any`, bara strukturellt permissiva,
och att tighta dem kostar mer än det smakar:

1. **`WhereInput<Row>`-värden är `unknown`** (+ `Record<string, unknown>`-escape
   för relations-filter). Striktare per-entitet-`where` skulle kräva Prisma-stil
   GENERERADE typer per entitet (100+ rader/entitet) för en söm som efter ADR
   0020 bara träffas internt i repo-lagret (~27 ställen) + en runtime-validerande
   query-engine. Ej motiverat. Behålls, runtime-validerat.
2. **Repo-metoders id-parametrar är `string`** (`getById(id: string)`), inte
   branded. Brandingen sker i stället vid `eq()`-gränsen via `asId<B>()`. Att
   branda params skulle tvinga `asId` ut till alla anropare (routrar får rena
   strängar ur tRPC-input) — det sprider casten i st.f. att lokalisera den.
   Behålls.

3. **Test-doubles** (~160 `as unknown as` i `test/`) är legitima `vi.fn`-mockar
   (IDataStore/`typeof fetch`/FSA-handles/`window.location`). Att tvinga riktiga
   typer där = bygga fulla fakes (mer kod, sämre testtydlighet). Behålls,
   baselinade; regeln blockerar ändå nya.

**Slutsats:** målen i #562 ("noll `as unknown as` + retire IDataStore-`any`") är
uppnådda för produktionskoden (`src/` + `tooling/`). Epiken kan stängas; residualen
ovan är dokumenterad och avsiktlig, inte teknisk skuld att beta av.

## Relaterat

Quick-wins: #557 (LocalStore-delegater), #559 (in-memory-delegering), #560
(`asRow`/`asRows`). ADR 0019 (Postgres-schema), ADR 0020 (repository-söm).
Fas 2-implementation (#562): PR #581 (invoice-branding), #585 (preferences),
#586 (in-memory-repos), #587 (demo-client), #589 (#588 fileSize-bugg), #590
(calendar), #591 (DocUtils), #592 (data-store-söm), #593 (static-params +
server-first), #594 (ctx.dataStore → `Pick<…,"events">`), #595 (tooling `sql<T>`).
