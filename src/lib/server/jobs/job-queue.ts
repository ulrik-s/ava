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
 * Anslutning: connectionString (pg-boss egen pool). `fromDrizzle`-adaptern delar
 * pool men antar `pg`-resultatformen (`.rows`) → krockar med vårt postgres-js +
 * pglite — därför egen connection (samma DB, eget schema).
 */

import { PgBoss } from "pg-boss";

/** De server-sidiga jobb-köerna (Fas 3 kopplar in handlers). */
export const JOB_QUEUES = {
  emailDispatch: "email-dispatch",
  fortnoxSync: "fortnox-sync",
  rulesTick: "rules-tick",
  outlookMirror: "outlook-mirror",
} as const;

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
