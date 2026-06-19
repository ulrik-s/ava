/**
 * Postgres-testhjälp (ADR 0019/0020). Två lägen, samma `createTestDb()`-API:
 *
 *  - **Default (pglite):** kör en Postgres-motor in-process (WASM, ingen docker)
 *    — snabbt, körs i den vanliga unit-test-jobben.
 *  - **`PG_TEST_URL` satt:** kör mot en RIKTIG Postgres (docker-compose.test.yml
 *    i CI:s "Repository (Postgres)"-jobb) → fångar driver-/SQL-skillnader som
 *    WASM-emuleringen missar. Varje handle får ett isolerat schema (migrationerna
 *    är icke-idempotenta `CREATE TABLE`), som droppas på `close`.
 *
 * `--> statement-breakpoint`-raderna i migrations-SQL:en är `--`-kommentarer →
 * hela filen kan exec:as i ett svep.
 */

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { uuidv7 } from "@/lib/shared/uuid";

const MIGRATIONS_DIR = "tooling/db/migrations";

export interface TestDbHandle {
  db: AppDb;
  close: () => Promise<void>;
}

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
}

async function createPgliteTestDb(): Promise<TestDbHandle> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  for (const sql of migrationSql()) await client.exec(sql);
  return { db: db, close: () => client.close() };
}

/** Mot riktig Postgres: isolerat schema per handle (parallell-säkert), droppas på close. */
async function createRealPgTestDb(url: string): Promise<TestDbHandle> {
  const schemaName = `t_${uuidv7().replace(/-/g, "")}`;
  // max:1 → en enda connection så search_path persisterar genom hela handle:n.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client.unsafe(`CREATE SCHEMA "${schemaName}"; SET search_path TO "${schemaName}"`);
  for (const sql of migrationSql()) await client.unsafe(sql);
  const db = drizzlePostgres(client, { schema });
  return {
    db: db,
    close: async () => {
      await client.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await client.end({ timeout: 5 });
    },
  };
}

export async function createTestDb(): Promise<TestDbHandle> {
  const url = process.env.PG_TEST_URL;
  return url ? createRealPgTestDb(url) : createPgliteTestDb();
}
