/**
 * Job-worker-runtime (#504 Fas 2) — startar pg-boss-kön och registrerar
 * worker-handlers i server-first-runtimen, med graceful shutdown.
 *
 * pg-boss ÄR worker-loopen: `boss.work(queue, handler)` pollar, claim:ar (FOR
 * UPDATE SKIP LOCKED), kör handlern, ack:ar vid succé och retry:ar/dead-letter:ar
 * vid fel. Här wirar vi bara livscykeln (start → registrera → stop) + en
 * handler-karta som Fas 3 fyller (utskick/Fortnox/regler). Tom karta = kön körs
 * (redo att ta emot jobb) men ingen handler konsumerar ännu.
 */

import type { Job, PgBoss } from "pg-boss";
import { log } from "@/lib/shared/observability/logger";
import { errorMessage } from "@/lib/shared/observability/redact";
import {
  JOB_QUEUES,
  JOB_SCHEDULE_TZ,
  JOB_SCHEDULES,
  type JobQueueName,
  type JobSchedule,
  createJobQueue,
  startJobQueue,
} from "./job-queue";

/** En handler kör ETT jobb. Kastar → pg-boss retry:ar (backoff) → dead-letter. */
export type JobHandler = (job: Job) => Promise<void>;

/** Per-kö-handlers. Saknad kö = ingen worker (jobb köas men konsumeras ej). */
export type JobHandlers = Partial<Record<JobQueueName, JobHandler>>;

export interface JobRuntime {
  /** Den startade pg-boss-instansen (för enqueue, t.ex. QueueBackedEmailSender). */
  boss: PgBoss;
  /** Stoppa pollingen och stäng pg-boss-anslutningen (graceful). */
  stop(): Promise<void>;
}

export interface JobRuntimeOptions {
  connectionString: string;
  schema?: string;
  handlers?: JobHandlers;
  /** Schemalagda jobb (standard `JOB_SCHEDULES`); tester skickar en egen lista. */
  schedules?: readonly JobSchedule[];
}

/** Den del av pg-boss som schemaregistreringen använder (fejkbar i enhetstester). */
export type ScheduleBoss = Pick<PgBoss, "schedule" | "unschedule" | "getSchedules">;

/**
 * Starta kön + registrera workers. Returnerar en handle med `stop()` för
 * shutdown. pg-boss kräver en `error`-lyssnare (annars kraschar processen på
 * connection-fel) — vi loggar.
 */
export async function startJobRuntime(opts: JobRuntimeOptions): Promise<JobRuntime> {
  const boss = createJobQueue({
    connectionString: opts.connectionString,
    ...(opts.schema ? { schema: opts.schema } : {}),
  });
  boss.on("error", (err: unknown) => log.error("jobqueue.error", { message: errorMessage(err) }));
  await startJobQueue(boss);
  const handlers = opts.handlers ?? {};
  await registerWorkers(boss, handlers);
  await registerSchedules(boss, handlers, opts.schedules ?? JOB_SCHEDULES);
  return { boss, stop: () => boss.stop({ graceful: true }) };
}

/** Registrera en `boss.work`-worker per kö som har en handler. */
async function registerWorkers(
  boss: Awaited<ReturnType<typeof createJobQueue>>,
  handlers: JobHandlers,
): Promise<void> {
  for (const name of Object.values(JOB_QUEUES)) {
    const handler = handlers[name];
    if (!handler) continue;
    await boss.work(name, async (jobs: Job[]) => {
      for (const job of jobs) await handler(job);
    });
  }
}

/**
 * Stäm av pg-boss scheman mot deklarationen: scheman vars kö saknar handler
 * registreras inte (inga jobb utan konsument), och sparade scheman som inte
 * ska finnas tas bort. Idempotent: pg-boss skriver över samma namn.
 */
export async function registerSchedules(
  boss: ScheduleBoss,
  handlers: JobHandlers,
  schedules: readonly JobSchedule[],
): Promise<void> {
  const wanted = schedules.filter((s) => handlers[s.queue]);
  const wantedNames = new Set<string>(wanted.map((s) => s.queue));
  for (const existing of await boss.getSchedules()) {
    if (!wantedNames.has(existing.name)) await boss.unschedule(existing.name, existing.key);
  }
  for (const s of wanted) {
    await boss.schedule(s.queue, s.cron, null, { tz: JOB_SCHEDULE_TZ, missed: s.missed ?? "once" });
  }
}
