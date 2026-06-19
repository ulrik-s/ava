# ADR 0026 — Branda persistens-gränsen (typad delegate + branded kolumner)

Status: Accepterad — Fas 1 implementerad (2026-06-19), Fas 2 spårad (#562)

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

### Fas 2 — branda drizzle-kolumnerna (spårat, ej i denna PR)

`.$type<XId>()` på id/FK-kolumnerna i `db/schema.ts` så `db.select()` bär
branded id:n → `asRow`/`asRows`-castarna blir onödiga. **Probe** (jun 2026)
visade att branding av en kolumn kaskaderar: `eq(matters.id, stringParam)`
slutar matcha → query-param-typerna + repo-metod-signaturerna måste brandas
(`getById(id: MatterId)`) över 27 entiteter, plus de delade `baseColumns`. Görs
som en koordinerad per-entitet/lager-PR-serie. Inte ett quick-win.

## Konsekvenser

- **Noll explicit `any`** i src — `no-explicit-any: error` utan undantag (ratchet
  låst i topp). Den största delen av användarens "no any anywhere"-mål uppnått.
- Delegate-query-input är nu strukturellt typad (arg-formen tvingas, fält-nyckel-
  autocomplete) men where-VÄRDEN är permissiva (`unknown`) — runtime-validerat.
- Fas 2 (branded kolumner) tar bort de återstående ORM-gräns-castarna; spåras i
  #562. Net `as unknown as` denna session: 213 → 109.

## Relaterat

Quick-wins: #557 (LocalStore-delegater), #559 (in-memory-delegering), #560
(`asRow`/`asRows`). ADR 0019 (Postgres-schema), ADR 0020 (repository-söm). #562.
