/**
 * pglite-testhjälp (ADR 0019/0020) — kör en riktig Postgres-motor in-process
 * (WASM, ingen docker) och applicerar de genererade drizzle-migrationerna, så
 * Drizzle-repositories kan testas mot äkta SQL. `--> statement-breakpoint`-
 * raderna i migrations-SQL:en är `--`-kommentarer → hela filen kan exec:as.
 */

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/server/db/schema";

const MIGRATIONS_DIR = "tooling/db/migrations";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDbHandle {
  db: TestDb;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
  }
  return { db, close: () => client.close() };
}
