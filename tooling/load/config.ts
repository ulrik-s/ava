/**
 * Lasttestets konfiguration (#1366) — allt styrs via miljövariabler, så att
 * samma skript kör den korta CI-varianten, 50 användare och 30-minuterssoaken.
 *
 * Miljön är extern data: den tolkas med zod, och ett felstavat tal ger ett
 * tydligt fel i stället för `NaN` någonstans mitt i en körning.
 */

import { z } from "zod";

/** Scenarierna i issue #1366, i den ordning de körs. */
export const SCENARIOS = ["work", "storm", "invoice", "documents", "idempotency"] as const;
export const scenarioSchema = z.enum(SCENARIOS);
export type Scenario = z.infer<typeof scenarioSchema>;

/** Högst tre byråer: en server-first-container per byrå (single-org-servern, ADR 0016). */
export const MAX_ORGS = 3;

const int = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);

const positive = (fallback: number) => int(fallback, 1);

const optionalPositive = z.coerce.number().positive().optional();

/** "a, b,,c" → ["a", "b", "c"]. */
function list(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
}

const scenarioList = z.string().default(SCENARIOS.join(",")).transform(list).pipe(z.array(scenarioSchema).min(1));

const opList = (fallback: readonly string[]) => z.string().default(fallback.join(",")).transform(list);

/** De anrop p95-kravet gäller ("push/pull och vanliga anrop"). */
const DEFAULT_P95_OPS = ["sync.pull", "sync.push", "sync.replay", "sync.reportDevice", "document.search", "document.downloadContent"];

/** Rå miljö → typad config. Varje nyckel har ett default som ger CI-körningen. */
const envSchema = z.object({
  LOAD_USERS: positive(20),
  LOAD_ORGS: z.coerce.number().int().min(1).max(MAX_ORGS).default(2),
  LOAD_SCENARIOS: scenarioList,
  LOAD_SEED: int(1366),
  /** Scenario 1:s längd. LOAD_SOAK=1 ger issuets 30 minuter. */
  LOAD_DURATION_S: positive(60),
  LOAD_SOAK: z.enum(["0", "1"]).default("0"),
  /** Medeltid mellan två handlingar per användare i scenario 1 ("realistisk takt"). */
  LOAD_THINK_MS: positive(3000),
  /** Webbläsarens bakgrundssynk (`use-auto-sync`: 60 s). */
  LOAD_POLL_MS: positive(60_000),
  /** Scenario 2: hur många ändringar varje användare köar offline. */
  LOAD_OFFLINE_MIN: positive(50),
  LOAD_OFFLINE_MAX: positive(200),
  /** Scenario 3: fakturor per fakturerande användare, och KR-ärenden per användare. */
  LOAD_INVOICES_PER_USER: positive(5),
  LOAD_KR_PER_USER: int(2),
  /** Scenario 4: uppladdningar per användare och storlek. */
  LOAD_UPLOADS_PER_USER: positive(3),
  LOAD_UPLOAD_KB: positive(64),
  /** Scenario 5: flikar per användare och mutationer som skickas från alla. */
  LOAD_TABS: z.coerce.number().int().min(2).default(4),
  LOAD_IDEMPOTENT_CALLS: positive(10),
  /** Var stacken finns (sätts av load-test.sh). */
  LOAD_HOST: z.string().default("localhost"),
  LOAD_PORT_BASE: positive(53100),
  LOAD_PG_PORT: positive(55433),
  LOAD_PG_USER: z.string().default("ava"),
  LOAD_PG_PASSWORD: z.string().default("ava"),
  LOAD_CONTAINERS: z.string().default(""),
  LOAD_PG_CONTAINER: z.string().default(""),
  LOAD_REPORT_DIR: z.string().default("reports/load"),
  /** Gränser (issue #1366, justerbara efter första körningen). */
  LOAD_MAX_P95_MS: positive(500),
  LOAD_P95_OPS: opList(DEFAULT_P95_OPS),
  LOAD_MAX_5XX: int(0),
  /** Tom = 120 s upp till 20 användare, annars 300 s (issuets krav). */
  LOAD_MAX_DRAIN_S: optionalPositive,
  LOAD_MAX_LOCK_WAIT_MS: positive(1000),
  LOAD_MAX_DEADLOCKS: int(0),
  LOAD_MAX_JOB_DRAIN_S: positive(120),
  /** Tom = bara rapporterat. */
  LOAD_MAX_SERVER_MEM_MIB: optionalPositive,
});

/** Gränserna lasttestet kräver. */
export interface Thresholds {
  maxP95Ms: number;
  p95Ops: readonly string[];
  max5xx: number;
  maxDrainS: number;
  maxLockWaitMs: number;
  maxDeadlocks: number;
  maxJobDrainS: number;
  maxServerMemMiB: number | null;
}

/** En byrå: dess server och dess databas. */
export interface OrgTarget {
  index: number;
  organizationId: string;
  serverUrl: string;
  databaseUrl: string;
}

export interface LoadConfig {
  users: number;
  orgs: readonly OrgTarget[];
  scenarios: readonly Scenario[];
  seed: number;
  durationS: number;
  thinkMs: number;
  pollMs: number;
  offlineMin: number;
  offlineMax: number;
  invoicesPerUser: number;
  krPerUser: number;
  uploadsPerUser: number;
  uploadKb: number;
  tabs: number;
  idempotentCalls: number;
  /** Databasen statistiken läses ur (instansövergripande vyer). */
  adminDatabaseUrl: string;
  containers: readonly string[];
  pgContainer: string | null;
  reportDir: string;
  thresholds: Thresholds;
}

/** Issuets 30-minuterssoak. */
export const SOAK_DURATION_S = 30 * 60;

/** Byrå-id:n är fasta, så att load-test.sh och skriptet är överens utan att prata. */
export function orgId(index: number): string {
  return `00000000-0000-7000-8000-${String(1366_000 + index).padStart(12, "0")}`;
}

/** Databasnamnet för byrå `index` (1-baserat), samma som load-test.sh skapar. */
export function databaseName(index: number): string {
  return `ava_load_${index}`;
}

function drainLimit(users: number, explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  return users <= 20 ? 120 : 300;
}

type Env = z.infer<typeof envSchema>;

function orgTargets(env: Env): OrgTarget[] {
  const pg = `postgres://${env.LOAD_PG_USER}:${env.LOAD_PG_PASSWORD}@${env.LOAD_HOST}:${env.LOAD_PG_PORT}`;
  return Array.from({ length: env.LOAD_ORGS }, (_, i) => ({
    index: i + 1,
    organizationId: orgId(i + 1),
    serverUrl: `http://${env.LOAD_HOST}:${env.LOAD_PORT_BASE + i + 1}`,
    databaseUrl: `${pg}/${databaseName(i + 1)}`,
  }));
}

function thresholds(env: Env): Thresholds {
  return {
    maxP95Ms: env.LOAD_MAX_P95_MS,
    p95Ops: env.LOAD_P95_OPS,
    max5xx: env.LOAD_MAX_5XX,
    maxDrainS: drainLimit(env.LOAD_USERS, env.LOAD_MAX_DRAIN_S),
    maxLockWaitMs: env.LOAD_MAX_LOCK_WAIT_MS,
    maxDeadlocks: env.LOAD_MAX_DEADLOCKS,
    maxJobDrainS: env.LOAD_MAX_JOB_DRAIN_S,
    maxServerMemMiB: env.LOAD_MAX_SERVER_MEM_MIB ?? null,
  };
}

/** Tolka miljön. Kastar med zods beskrivning av vad som var fel. */
export function parseLoadConfig(raw: Record<string, string | undefined>): LoadConfig {
  const env = envSchema.parse(raw);
  if (env.LOAD_OFFLINE_MIN > env.LOAD_OFFLINE_MAX) {
    throw new Error(`LOAD_OFFLINE_MIN (${env.LOAD_OFFLINE_MIN}) är större än LOAD_OFFLINE_MAX (${env.LOAD_OFFLINE_MAX})`);
  }
  const orgs = orgTargets(env);
  return {
    users: env.LOAD_USERS,
    orgs,
    scenarios: env.LOAD_SCENARIOS,
    seed: env.LOAD_SEED,
    durationS: env.LOAD_SOAK === "1" ? SOAK_DURATION_S : env.LOAD_DURATION_S,
    thinkMs: env.LOAD_THINK_MS,
    pollMs: env.LOAD_POLL_MS,
    offlineMin: env.LOAD_OFFLINE_MIN,
    offlineMax: env.LOAD_OFFLINE_MAX,
    invoicesPerUser: env.LOAD_INVOICES_PER_USER,
    krPerUser: env.LOAD_KR_PER_USER,
    uploadsPerUser: env.LOAD_UPLOADS_PER_USER,
    uploadKb: env.LOAD_UPLOAD_KB,
    tabs: env.LOAD_TABS,
    idempotentCalls: env.LOAD_IDEMPOTENT_CALLS,
    adminDatabaseUrl: orgs[0]?.databaseUrl ?? "",
    containers: list(env.LOAD_CONTAINERS),
    pgContainer: env.LOAD_PG_CONTAINER || null,
    reportDir: env.LOAD_REPORT_DIR,
    thresholds: thresholds(env),
  };
}
