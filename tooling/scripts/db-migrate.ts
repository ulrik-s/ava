#!/usr/bin/env bun
/**
 * `db:migrate` — applicera de versionerade SQL-migrationerna (`tooling/db/migrations/`)
 * mot en Postgres (ADR 0019). Den saknade biten för att DEPLOYA server-first-
 * runtimen (#410): `createPostgresDb` ansluter bara — schemat måste finnas.
 *
 * Tester applicerar migrationerna via `pg-test-db.ts` (isolerade scheman);
 * detta är produktions-/deploy-vägen (publikt schema mot en riktig db-URL).
 *
 *   AVA_DATABASE_URL=postgres://… bun run db:migrate
 *   bun run db:migrate "postgres://…"            # eller som argument
 *
 * `--> statement-breakpoint`-raderna i SQL:en är `--`-kommentarer → hela filen
 * kan exec:as i ett svep.
 */

import { readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";

const MIGRATIONS_DIR = "tooling/db/migrations";

/** SQL-migrationerna i lexikografisk ordning (0000_, 0001_, …). */
export function migrationSql(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"));
}

/** Applicera alla migrationer på en redan öppnad postgres-klient. */
export async function applyMigrations(client: postgres.Sql, dir: string = MIGRATIONS_DIR): Promise<number> {
  const files = migrationSql(dir);
  for (const sql of files) await client.unsafe(sql);
  return files.length;
}

/** Anslut till `url`, applicera migrationerna, stäng. Returnerar antal applicerade. */
export async function migrate(url: string): Promise<number> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await applyMigrations(client);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? process.env.AVA_DATABASE_URL;
  if (!url) {
    process.stderr.write("db:migrate: ange Postgres-URL via AVA_DATABASE_URL eller argument\n");
    process.exitCode = 1;
    return;
  }
  const n = await migrate(url);
  process.stdout.write(`db:migrate: ${n} migrationer applicerade\n`);
}

// Kör bara som script (inte vid import i tester).
if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`db:migrate: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
