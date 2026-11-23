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
 * Anslutning: connectionString (pg-boss egen pool). `fromDrizzle`-adaptern delar
 * pool men antar `pg`-resultatformen (`.rows`) → krockar med vårt postgres-js +
 * pglite — därför egen connection (samma DB, eget schema).
 */

import { PgBoss, type ScheduleOptions } from "pg-boss";

/** De server-sidiga jobb-köerna (Fas 3 kopplar in handlers). */
export const JOB_QUEUES = {
  emailDispatch: "email-dispatch",
  classifyDocument: "classify-document",
  /** Indexera ett dokuments sidtext utan omklassificering (#1215, backfill). */
  indexDocument: "index-document",
  fortnoxSync: "fortnox-sync",
  rulesTick: "rules-tick",
  /** Håll bokföringsanslutningen vid liv, veckovis (#1815). */
  ledgerKeepAlive: "ledger-keepalive",
} as const;

export type JobQueueName = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

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

/**
 * Starta pg-boss (skapar/migrerar `pgboss`-schemat — idempotent) och registrera
 * alla köer med retry + exponentiell backoff. Anropa en gång vid server-start.
 */
export async function startJobQueue(boss: PgBoss, retryLimit = DEFAULT_RETRY_LIMIT): Promise<void> {
  await boss.start();
  for (const name of Object.values(JOB_QUEUES)) {
    await boss.createQueue(name, { retryLimit, retryBackoff: true });
  }
}
