/**
 * Postgres under last (#1366): anslutningar, låsväntan och deadlocks.
 *
 * Två källor, eftersom ingen av dem räcker ensam:
 *   - sampling av `pg_stat_activity` (var 250:e ms) — anslutningar per
 *     applikation och tillstånd, och hur länge den som väntat längst på ett
 *     lås har väntat just nu;
 *   - Postgres egen logg med `log_lock_waits=on` (load-compose) — varje väntan
 *     längre än `deadlock_timeout` (1 s) loggas exakt, även mellan två samplingar.
 * Deadlocks räknas ur `pg_stat_database` (före/efter).
 */

import postgres from "postgres";
import { z } from "zod";

/** En sampling av `pg_stat_activity`. */
export interface ActivitySample {
  total: number;
  active: number;
  idleInTransaction: number;
  lockWaiters: number;
  maxLockWaitMs: number;
}

/** Sammanfattning av Postgres-mätningarna. */
export interface PgSummary {
  maxConnections: number;
  peakConnections: number;
  peakActive: number;
  peakIdleInTransaction: number;
  peakLockWaiters: number;
  /** Längsta låsväntan sett i en sampling (ms, upplösning ~250 ms). */
  maxSampledLockWaitMs: number;
  /** Väntan > deadlock_timeout enligt Postgres logg. */
  lockWaitsOverTimeout: number;
  /** Längsta väntan Postgres loggade ("acquired … after N ms"). */
  maxLoggedLockWaitMs: number;
  deadlocks: number;
  deadlocksLogged: number;
  samples: number;
}

/** Låsväntan och deadlocks ur Postgres logg (`log_lock_waits=on`). */
export interface LockLog {
  waitsOverTimeout: number;
  maxWaitMs: number;
  deadlocks: number;
}

const WAITING = /still waiting for .* after ([\d.]+) ms/;
const ACQUIRED = /acquired .* after ([\d.]+) ms/;

/** Läs låsväntan och deadlocks ur Postgres logg. */
export function parseLockLog(log: string): LockLog {
  let waitsOverTimeout = 0;
  let maxWaitMs = 0;
  let deadlocks = 0;
  for (const line of log.split("\n")) {
    const waiting = WAITING.exec(line);
    if (waiting) waitsOverTimeout++;
    const ms = Number((waiting ?? ACQUIRED.exec(line))?.[1] ?? 0);
    if (ms > maxWaitMs) maxWaitMs = ms;
    if (line.includes("deadlock detected")) deadlocks++;
  }
  return { waitsOverTimeout, maxWaitMs: Math.round(maxWaitMs), deadlocks };
}

/** Toppvärden ur samplingarna. */
export function peakOf(samples: readonly ActivitySample[]): ActivitySample {
  const peak = (f: (s: ActivitySample) => number): number => Math.max(0, ...samples.map(f));
  return {
    total: peak((s) => s.total),
    active: peak((s) => s.active),
    idleInTransaction: peak((s) => s.idleInTransaction),
    lockWaiters: peak((s) => s.lockWaiters),
    maxLockWaitMs: Math.round(peak((s) => s.maxLockWaitMs)),
  };
}

const activityRow = z.object({
  total: z.coerce.number(),
  active: z.coerce.number(),
  idle_in_tx: z.coerce.number(),
  lock_waiters: z.coerce.number(),
  max_lock_wait_ms: z.coerce.number(),
});

const deadlockRow = z.object({ deadlocks: z.coerce.number() });
const settingRow = z.object({ max_connections: z.coerce.number() });

/** Samplar Postgres-instansen under körningen. */
export class PgSampler {
  private readonly sql;
  private readonly samples: ActivitySample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private deadlocksBefore = 0;

  constructor(adminUrl: string) {
    this.sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  }

  private async deadlockCount(): Promise<number> {
    const rows = await this.sql`SELECT coalesce(sum(deadlocks), 0) AS deadlocks FROM pg_stat_database`;
    return deadlockRow.parse(rows[0]).deadlocks;
  }

  private async sampleOnce(): Promise<void> {
    // Lastgeneratorns egen samplingsanslutning räknas inte (pg_backend_pid()).
    const rows = await this.sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE state = 'active') AS active,
             count(*) FILTER (WHERE state LIKE 'idle in transaction%') AS idle_in_tx,
             count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waiters,
             coalesce(max(extract(epoch FROM now() - query_start) * 1000) FILTER (WHERE wait_event_type = 'Lock'), 0) AS max_lock_wait_ms
      FROM pg_stat_activity
      WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()`;
    this.samples.push((({ total, active, idle_in_tx, lock_waiters, max_lock_wait_ms }) => ({
      total, active, idleInTransaction: idle_in_tx, lockWaiters: lock_waiters, maxLockWaitMs: max_lock_wait_ms,
    }))(activityRow.parse(rows[0])));
  }

  async start(intervalMs = 250): Promise<void> {
    this.deadlocksBefore = await this.deadlockCount();
    this.timer = setInterval(() => { void this.sampleOnce().catch(() => undefined); }, intervalMs);
  }

  /** Stoppa och sammanfatta; `lockLog` är Postgres logg för körningen (tom om den inte gick att läsa). */
  async stop(lockLog: LockLog): Promise<PgSummary> {
    if (this.timer !== null) clearInterval(this.timer);
    const deadlocks = (await this.deadlockCount()) - this.deadlocksBefore;
    const setting = settingRow.parse((await this.sql`SELECT current_setting('max_connections')::int AS max_connections`)[0]);
    await this.sql.end({ timeout: 5 });
    const peak = peakOf(this.samples);
    return {
      maxConnections: setting.max_connections,
      peakConnections: peak.total,
      peakActive: peak.active,
      peakIdleInTransaction: peak.idleInTransaction,
      peakLockWaiters: peak.lockWaiters,
      maxSampledLockWaitMs: peak.maxLockWaitMs,
      lockWaitsOverTimeout: lockLog.waitsOverTimeout,
      maxLoggedLockWaitMs: lockLog.maxWaitMs,
      deadlocks,
      deadlocksLogged: lockLog.deadlocks,
      samples: this.samples.length,
    };
  }
}
