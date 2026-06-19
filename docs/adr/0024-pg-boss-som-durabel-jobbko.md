# ADR 0024 — pg-boss som durabel jobb-kö (server-first)

Status: Accepterad (2026-06-19)

## Kontext

#421 tog bort den gamla git-peer-runtimens jobb-system (peer-loop +
`compose-jobs`/`rules-job` + `filesystem-claim-store`/`filesystem-event-log`)
och därmed dess durabilitet. Server-first (`bin/server-first.ts`, ADR 0016)
behöver server-sidiga jobb — e-postutskick (`email-dispatch`),
dokumentklassificering (`classify-document`, #518), Fortnox-sync, regelmotor,
Outlook-spegling — som **tål en server-restart** och varken tappas eller
dubbelkörs.

#504 formulerade kravet som en **egen** Postgres-backad kö: en `jobs`-tabell +
`JobQueueRepository` med claim/lease (`SELECT … FOR UPDATE SKIP LOCKED`),
retry/backoff, idempotens och status-fält.

Sedan #504 skrevs har dock **pg-boss** redan wirats in i server-first-runtimen
(`src/lib/server/jobs/job-queue.ts`, `startJobRuntime`). pg-boss är ett moget
bibliotek som gör *exakt* det #504 beskriver, byggt på samma Postgres-
primitiver.

## Beslut

**pg-boss ÄR den durabla jobb-kön. Vi bygger ingen egen `jobs`-tabell/-kö.**
Att underhålla en andra kö-implementation parallellt med pg-boss vore ett brott
mot DRY och en onödig underhållsbörda, utan funktionell vinst.

Varje krav i #504 mappas mot pg-boss:

| #504-krav | pg-boss |
|-----------|---------|
| Claim/lease, ingen dubbelkörning | `fetch` använder `FOR UPDATE SKIP LOCKED`; en kraschad workers lease löper ut → jobbet återtas |
| Retry/backoff, `maxAttempts` | `createQueue(name, { retryLimit, retryBackoff: true })` (`startJobQueue`, retryLimit 5) |
| `runAfter` (fördröjd/schemalagd) | `send(name, data, { startAfter })`; cron via `schedule()` |
| Dead-letter | inbyggt `failed`-state efter uttömda retries |
| Status `queued/running/done/failed` | pg-boss jobb-state-maskin |
| Durabelt, inget körande tillstånd i processen | allt committat i Postgres (eget `pgboss`-schema, skilt från drizzle-`public`) |
| Idempotens (UUIDv7, ADR 0017) | se nedan |

### Idempotens

Två lager, i linje med ADR 0017 ("server upsertar på id → ingen dubbel-skapande
vid omspelning"):

1. **Enqueue-dedupe (`singletonKey`):** anrop till `send` förses med en stabil
   nyckel så att som mest ETT väntande/aktivt jobb finns per nyckel — upprepade
   triggers (reconcile-replay, dubbelklick, at-least-once-anrop uppströms)
   skapar inte dubbletter.
   - `classify-document`: `singletonKey = documentId` — det väntande jobbet
     läser ändå dokumentets aktuella state, så att droppa dubbletten är säkert.
   - `email-dispatch`: `singletonKey = SendEmailInput.idempotencyKey` när
     anroparen anger den (t.ex. fakturans/påminnelsens UUIDv7) → en replay
     skickar inte samma mejl två gånger. Utan nyckel: oförändrat beteende.

2. **Idempotenta handlers:** varje handler ska kunna köras om utan biverkningar
   (classify skriver samma `documentType`; metadata-uppdateringar är upsertande).
   Detta är handler-design, inte kö-infrastruktur.

### Avgränsning

pg-boss kör sin egen schema-migration (`boss.start()`) i sitt `pgboss`-schema —
det ligger utanför drizzle-toolchainen (ADR 0019) med flit; de delar bara
Postgres-instans, inte schema. `fromDrizzle`-adaptern används INTE (antar
`pg`-resultatformen, krockar med postgres-js/pglite) → pg-boss får egen
connection mot samma DB.

## Konsekvenser

- **#504 stängs** — durabilitetskravet är uppfyllt av pg-boss; den egna kön
  byggs inte.
- Nya server-jobb läggs till genom att (a) lägga ett namn i `JOB_QUEUES`, (b)
  registrera en handler i `buildServerFirstJobHandlers`, (c) enqueue:a via en
  port (`QueueBackedEmailSender`/`QueueBackedDocumentAnalyzer`-mönstret) med en
  `singletonKey` när idempotens behövs.
- Enhetstester mockar `boss.send` och verifierar payload + `singletonKey`; ett
  riktigt pg-boss-mot-Postgres-test behövs inte för portarna.
- Om vi någon gång vill bort från pg-boss-beroendet får en egen kö övervägas på
  nytt — men först när ett konkret skäl finns (denna ADR supersedas då).

## Relaterat

ADR 0016 (server-first), ADR 0017 (idempotens/UUIDv7), ADR 0019 (Postgres-
schema/toolchain), ADR 0020 (repository-söm). Ersätter durabiliteten som
försvann i #421. Stänger #504.
