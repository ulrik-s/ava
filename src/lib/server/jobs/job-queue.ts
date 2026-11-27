/**
 * Server-sidig durabel jobb-kö via **pg-boss** (#504).
 *
 * pg-boss äger sitt EGET `pgboss`-schema i samma Postgres-DB (skilt från
 * drizzle-app-schemat i `public`) och ger claim/lease (`FOR UPDATE SKIP
 * LOCKED`), retry med exponentiell backoff, dead-letter och cron out-of-the-box
 * — alltså exakt durabiliteten som försvann med git-peer-runtimen (#421). En
 * kraschad/omstartad server tappar inga köade jobb (de ligger i Postgres) och
 * dubbelkör dem inte (lease + SKIP LOCKED).
 *
 * "Använd biblioteket rakt av": vi wrappar bara namngivningen av köerna + start-
 * sekvensen. Handlers registreras direkt via `boss.work(name, …)` (Fas 2).
 *
 * Schemalagda jobb (#1802, ADR 0024 "cron via `schedule()`"): lägg en post i
 * `JOB_SCHEDULES` (kö + cron-uttryck i svensk tid + ev. `missed`) och bygg köns
 * handler i `buildServerFirstJobHandlers`. `startJobRuntime` registrerar schemat
 * vid start med `boss.schedule`, bara om kön har en handler, och tar bort
 * scheman i databasen som inte längre är deklarerade. Inga egna `setInterval`.
 *
 * Köpolicy (#1900, ADR 0024): `singletonKey` stoppar bara dubbletter i en kö
 * med en policy (`exclusive`, `stately` …); med standardpolicyn gör nyckeln
 * ingenting. En kös policy kan inte bytas efter att kön skapats, så ett byte
 * görs med en ny kö (`-v2`), och den gamla kön töms av samma handler
 * (`RETIRED_JOB_QUEUES`).
 *
 * Anslutning: connectionString (pg-boss egen pool). `fromDrizzle`-adaptern delar
 * pool men antar `pg`-resultatformen (`.rows`) → krockar med vårt postgres-js +
 * pglite — därför egen connection (samma DB, eget schema).
 */

import { PgBoss, type Queue, type ScheduleOptions } from "pg-boss";

/** De server-sidiga jobb-köerna (Fas 3 kopplar in handlers). */
export const JOB_QUEUES = {
  /** `exclusive`: som mest ett köat eller pågående mejl per nyckel (#1900). */
  emailDispatch: "email-dispatch-v2",
  /** `stately`: som mest ett köat och ett pågående jobb per dokument (#1900). */
  classifyDocument: "classify-document-v2",
  /** Indexera ett dokuments sidtext utan omklassificering (#1215, backfill). */
  indexDocument: "index-document",
  /** Håll bokföringsanslutningen vid liv, veckovis (#1815). */
  ledgerKeepAlive: "ledger-keepalive",
} as const;

export type JobQueueName = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

/** Hur länge ett köat jobb (created/retry) får vänta innan pg-boss tar bort det: 14 dagar. */
export const QUEUED_JOB_RETENTION_SECONDS = 14 * 24 * 60 * 60;

/** En kös egna optioner utöver retry: policyn som gör `singletonKey` unik (#1900). */
export type JobQueueOptionsFor = Pick<Queue, "policy" | "retentionSeconds">;

/** Köernas policy och retention; en kö som använder `singletonKey` ska ha en post här. */
export const JOB_QUEUE_OPTIONS: Partial<Record<JobQueueName, JobQueueOptionsFor>> = {
  [JOB_QUEUES.emailDispatch]: { policy: "exclusive", retentionSeconds: QUEUED_JOB_RETENTION_SECONDS },
  [JOB_QUEUES.classifyDocument]: { policy: "stately", retentionSeconds: QUEUED_JOB_RETENTION_SECONDS },
};

/**
 * De gamla köerna (utan policy) och kön som ersatt dem (#1900). De skapas och
 * får en worker med efterträdarens handler: jobb som redan ligger i dem ska
 * köras klart, och en worker utan kö loggar `jobqueue.error` vid varje
 * pollning. Inget nytt köas här.
 */
export const RETIRED_JOB_QUEUES = {
  "email-dispatch": JOB_QUEUES.emailDispatch,
  "classify-document": JOB_QUEUES.classifyDocument,
} as const satisfies Record<string, JobQueueName>;

/** Tidszonen för alla schemalagda jobb: en kalenderdag i AVA är dagen i Stockholm (#1677). */
export const JOB_SCHEDULE_TZ = "Europe/Stockholm";

/** Ett schemalagt jobb: pg-boss köar ett jobb på `queue` enligt `cron` (svensk tid). */
export interface JobSchedule {
  /** Kön jobbet köas på; dess handler i `JobHandlers` kör det. */
  queue: JobQueueName;
  /** Cron-uttryck, tolkat i `JOB_SCHEDULE_TZ`. */
  cron: string;
  /** Tillfällen som missats under omstart/deploy: `once` (standard) kör ett efteråt, `skip` inget. */
  missed?: ScheduleOptions["missed"];
}

/** De schemalagda jobben, registrerade av `startJobRuntime`. */
export const JOB_SCHEDULES: readonly JobSchedule[] = [
  // Måndag 03:00: sex tillfällen inom refresh-tokenets 45 dygn (#1815).
  { queue: JOB_QUEUES.ledgerKeepAlive, cron: "0 3 * * 1" },
];

const DEFAULT_SCHEMA = "pgboss";
const DEFAULT_RETRY_LIMIT = 5;

export interface JobQueueOptions {
  /** Postgres-URL (samma DB som server-first; pg-boss skapar `pgboss`-schemat). */
  connectionString: string;
  /** pg-boss-schema (default `pgboss`). Sätt unikt i tester för isolering. */
  schema?: string;
}

/** Konstruera (men starta inte) pg-boss-instansen. */
export function createJobQueue(opts: JobQueueOptions): PgBoss {
  return new PgBoss({ connectionString: opts.connectionString, schema: opts.schema ?? DEFAULT_SCHEMA });
}

/** Den del av pg-boss som köstarten använder (fejkbar i enhetstester); `PgBoss` uppfyller den. */
export interface QueueBoss {
  start(): Promise<unknown>;
  createQueue(name: string, options?: Omit<Queue, "name">): Promise<void>;
}

/**
 * Starta pg-boss (skapar/migrerar `pgboss`-schemat — idempotent) och registrera
 * alla köer med retry + exponentiell backoff, och köns policy ur
 * `JOB_QUEUE_OPTIONS`. De gamla köerna skapas som förut, utan policy.
 * `createQueue` ändrar inte en befintlig kö. Anropa en gång vid server-start.
 */
export async function startJobQueue(boss: QueueBoss, retryLimit = DEFAULT_RETRY_LIMIT): Promise<void> {
  await boss.start();
  for (const name of Object.values(JOB_QUEUES)) {
    await boss.createQueue(name, { retryLimit, retryBackoff: true, ...JOB_QUEUE_OPTIONS[name] });
  }
  for (const name of Object.keys(RETIRED_JOB_QUEUES)) {
    await boss.createQueue(name, { retryLimit, retryBackoff: true });
  }
}
