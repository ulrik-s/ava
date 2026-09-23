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
 *   bun run db:migrate --baseline                # befintlig otrackad db, se nedan
 *
 * Spårning (#1107): `schema_migrations` håller vilka filer som körts; bara NYA
 * appliceras, var och en i en egen transaktion tillsammans med sin spår-rad —
 * en fil som fallerar lämnar varken halvt schema eller en rad som ljuger.
 *
 * En databas som HAR schemat men saknar spårning (migrerad före #1107) vägras:
 * vilka filer som körts går inte att härleda säkert. `--baseline` markerar
 * alla nuvarande filer som körda utan att köra dem — kör det EN gång, på
 * exakt den version databasen migrerades med.
 *
 * `--> statement-breakpoint`-raderna i SQL:en är `--`-kommentarer → hela filen
 * kan exec:as i ett svep.
 */

import { readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";
import { z } from "zod";

const MIGRATIONS_DIR = "tooling/db/migrations";

/** Filnamn inlinas i SQL (multi-statement tillåter inga parametrar) → strikt form. */
const MIGRATION_FILE = /^[\w-]+\.sql$/;

/** Den SQL-yta migreringen behöver — postgres.js `Sql` uppfyller den. */
export interface MigrationClient {
  unsafe(query: string): PromiseLike<readonly unknown[]>;
}

export interface Migration {
  filename: string;
  sql: string;
}

/** SQL-migrationerna i lexikografisk ordning (0000_, 0001_, …). */
export function migrationFiles(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      if (!MIGRATION_FILE.test(filename)) throw new Error(`ogiltigt migrationsnamn: ${filename}`);
      return { filename, sql: readFileSync(`${dir}/${filename}`, "utf8") };
    });
}

const appliedRows = z.array(z.object({ filename: z.string() }));
const existsRows = z.array(z.object({ present: z.boolean() }));

async function appliedFilenames(client: MigrationClient): Promise<Set<string>> {
  await client.unsafe(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const rows = appliedRows.parse(await client.unsafe(`SELECT filename FROM schema_migrations`));
  return new Set(rows.map((r) => r.filename));
}

/** Har databasen redan kärnschemat? (0000 skapar `organizations`.) */
async function hasUntrackedSchema(client: MigrationClient): Promise<boolean> {
  const rows = existsRows.parse(
    await client.unsafe(`SELECT to_regclass('organizations') IS NOT NULL AS present`),
  );
  return rows[0]?.present === true;
}

const track = (filename: string): string =>
  `INSERT INTO schema_migrations (filename) VALUES ('${filename}');`;

async function applyOne(client: MigrationClient, m: Migration): Promise<void> {
  try {
    await client.unsafe(`BEGIN;\n${m.sql}\n;${track(m.filename)}\nCOMMIT;`);
  } catch (err) {
    await client.unsafe("ROLLBACK");
    throw new Error(`${m.filename}: ${String(err)}`);
  }
}

export interface MigrateOptions {
  dir?: string;
  /** Markera alla filer som körda utan att köra dem (befintlig otrackad db). */
  baseline?: boolean;
}

/**
 * Applicera de migrationer som inte körts. Returnerar antalet som applicerades
 * (eller markerades, vid `baseline`). Kräver EN connection (postgres `max: 1`):
 * BEGIN/COMMIT måste hamna på samma session.
 */
export async function applyMigrations(client: MigrationClient, opts: MigrateOptions = {}): Promise<number> {
  const files = migrationFiles(opts.dir);
  const applied = await appliedFilenames(client);
  if (applied.size === 0 && (await hasUntrackedSchema(client))) {
    if (!opts.baseline) {
      throw new Error(
        "databasen har schemat men ingen schema_migrations — kör `db:migrate --baseline` en gång " +
          "(på den version den migrerades med) så spårningen tar vid",
      );
    }
    await client.unsafe(`BEGIN;${files.map((m) => track(m.filename)).join("")}COMMIT;`);
    return files.length;
  }
  const pending = files.filter((m) => !applied.has(m.filename));
  for (const m of pending) await applyOne(client, m);
  return pending.length;
}

/** Anslut till `url`, applicera väntande migrationer, stäng. */
export async function migrate(url: string, opts: MigrateOptions = {}): Promise<number> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await applyMigrations(client, opts);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const baseline = args.includes("--baseline");
  const url = args.find((a) => !a.startsWith("--")) ?? process.env.AVA_DATABASE_URL;
  if (!url) {
    process.stderr.write("db:migrate: ange Postgres-URL via AVA_DATABASE_URL eller argument\n");
    process.exitCode = 1;
    return;
  }
  const n = await migrate(url, { baseline });
  process.stdout.write(`db:migrate: ${n} migrationer ${baseline ? "markerade (baseline)" : "applicerade"}\n`);
}

// Kör bara som script (inte vid import i tester).
if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`db:migrate: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
