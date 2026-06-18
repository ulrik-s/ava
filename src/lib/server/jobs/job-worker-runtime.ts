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

import type { Job } from "pg-boss";
import { JOB_QUEUES, type JobQueueName, createJobQueue, startJobQueue } from "./job-queue";

/** En handler kör ETT jobb. Kastar → pg-boss retry:ar (backoff) → dead-letter. */
export type JobHandler = (job: Job) => Promise<void>;

/** Per-kö-handlers. Saknad kö = ingen worker (jobb köas men konsumeras ej). */
export type JobHandlers = Partial<Record<JobQueueName, JobHandler>>;

export interface JobRuntime {
  /** Stoppa pollingen och stäng pg-boss-anslutningen (graceful). */
  stop(): Promise<void>;
}

export interface JobRuntimeOptions {
  connectionString: string;
  schema?: string;
  handlers?: JobHandlers;
}

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
  boss.on("error", (err) => console.error("[job-queue] fel:", err));
  await startJobQueue(boss);
  await registerWorkers(boss, opts.handlers ?? {});
  return { stop: () => boss.stop({ graceful: true }) };
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
