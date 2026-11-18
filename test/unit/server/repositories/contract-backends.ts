/**
 * De två repository-backendarna som kontraktstesterna kör samma scenarier mot
 * (#1249, #1678): minnesrepona (webbläsaren, offline, demon) och Drizzle-repona
 * (Postgres via pglite, eller riktig Postgres när `PG_TEST_URL` är satt).
 */

import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import { type ChangeLogEntry, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { createTestDb } from "../db/pg-test-db";

/** Öppnade repon och hur de stängs. */
export interface OpenRepos {
  readonly repos: Repositories;
  readonly close: () => Promise<void>;
}

/** Minnesrepona; varje skrivning rapporteras som `MutationEvent`. */
export function openInMemoryRepos(onEvent: (e: MutationEvent<Record<string, unknown>>) => void = () => {}): OpenRepos {
  return { repos: buildInMemoryRepositories(new DemoDataStore({}, onEvent)), close: () => Promise.resolve() };
}

/** Drizzle-repona mot en ny databas; med `onLog` rapporteras varje change_log-rad. */
export async function openDrizzleRepos(onLog?: (e: ChangeLogEntry) => void): Promise<OpenRepos> {
  const handle = await createTestDb();
  const repos = buildDrizzleRepositories(handle.db);
  if (onLog) enableChangeLogOnAll(repos, { record: (entry) => { onLog(entry); return Promise.resolve(); } });
  return { repos, close: () => handle.close() };
}

/** Namnet på Drizzle-backenden: pglite i vanliga körningar, riktig Postgres i CI-jobbet. */
export const DRIZZLE_NAME = process.env.PG_TEST_URL ? "Drizzle (Postgres)" : "Drizzle (pglite)";
