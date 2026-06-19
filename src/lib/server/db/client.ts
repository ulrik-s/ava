/**
 * `createPostgresDb` — produktions-Postgres-handle för server-first-runtimen
 * (#410, ADR 0016/0019). node-postgres (`postgres`-drivern) + Drizzle, typad som
 * den driver-agnostiska {@link AppDb} så repositoryn (ADR 0020) inte kopplas till
 * en specifik driver.
 *
 * Server-only: drar in `postgres` + `drizzle-orm/postgres-js` och får ALDRIG
 * hamna i klient-bundeln (dep-cruiser-grind). Anslutningen är lat — `postgres()`
 * kopplar upp först vid första queryn.
 *
 * Testerna kör mot pglite/riktig Postgres via `test/.../pg-test-db.ts`
 * (`createTestDb`); den här fabriken är produktionsvägen (composition-root
 * `buildServerFirstApi` + `bin/server-first.ts`).
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { AppDb } from "./types";

export interface PostgresDb {
  /** Drizzle-handle som repositoryn byggs ovanpå. */
  db: AppDb;
  /** Stäng connection-poolen (vid nedstängning). */
  close: () => Promise<void>;
}

export interface PostgresDbOptions {
  /** Max antal connections i poolen (default: postgres-js standard). */
  max?: number;
}

/** Bygg ett Postgres-`AppDb`-handle mot `url` (t.ex. `postgres://…`). */
export function createPostgresDb(url: string, opts: PostgresDbOptions = {}): PostgresDb {
  const client = postgres(url, {
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
