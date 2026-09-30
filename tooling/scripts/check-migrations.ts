/**
 * `db:check-migrations` (#1251) — migrationerna skrivs för hand, och två
 * vanliga fel har bara upptäckts manuellt:
 *
 *   1. två PR:er tar SAMMA nummer samma dag (0027 fanns två gånger), så
 *      ordningen mellan dem avgörs av filnamnet efter numret;
 *   2. SQL:en och Drizzle-schemat glider isär — en kolumn som routrarna
 *      skriver finns inte i databasen, eller har en annan typ eller nullbarhet.
 *
 * Kontrollen kräver unika fyrsiffriga nummer, applicerar alla migrationer på
 * en tom Postgres (pglite) och jämför tabeller, kolumner, typer och NOT NULL
 * mot schemat. Körs som test i CI och går att köra lokalt:
 *
 *   bun run db:check-migrations
 */

import { PGlite } from "@electric-sql/pglite";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../src/lib/server/db/schema";
import { type Migration, migrationFiles } from "./db-migrate";

/** `0033_matter_conflict_check.sql` — fyra siffror, understreck, gemener. */
const NUMBERED = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Filnamn som inte följer formen. */
export function misnamedMigrations(files: readonly string[]): string[] {
  return files.filter((f) => !NUMBERED.test(f));
}

/** Nummer som används av mer än en migration, med filerna. */
export function duplicateMigrationNumbers(files: readonly string[]): string[] {
  const byNumber = new Map<string, string[]>();
  for (const f of files) {
    const n = NUMBERED.exec(f)?.[1];
    if (n) byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
  }
  return [...byNumber.entries()].filter(([, fs]) => fs.length > 1).map(([n, fs]) => `${n}: ${fs.join(", ")}`);
}

/** En kolumn som den ska vara (schemat) eller är (databasen). */
export interface ColumnShape {
  type: string;
  notNull: boolean;
}

/** `tabell.kolumn` → form. */
export type ColumnMap = ReadonlyMap<string, ColumnShape>;

/** Drizzles SQL-typ i `information_schema`s namn (serial är heltal med sekvens). */
export function normalizeType(sqlType: string): string {
  const base = sqlType.replace(/\(.*\)$/, "");
  if (base.endsWith("[]")) return "ARRAY";
  const aliases: Record<string, string> = { bigserial: "bigint", serial: "integer", smallserial: "smallint", varchar: "character varying" };
  return aliases[base] ?? base;
}

/** Kolumnerna enligt Drizzle-schemat. */
export function expectedColumns(tables: Record<string, unknown> = schema): Map<string, ColumnShape> {
  const out = new Map<string, ColumnShape>();
  for (const table of Object.values(tables)) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    for (const col of config.columns) {
      out.set(`${config.name}.${col.name}`, { type: normalizeType(col.getSQLType()), notNull: col.notNull });
    }
  }
  return out;
}

const nullability = (notNull: boolean): string => (notNull ? "NOT NULL" : "nullbar");

/** Skillnaden för en kolumn schemat har, eller null om databasen stämmer. */
function columnDrift(key: string, want: ColumnShape, got: ColumnShape | undefined): string | null {
  if (!got) return `${key}: saknas i databasen (${want.type})`;
  if (got.type !== want.type) return `${key}: typ ${got.type} i databasen, ${want.type} i schemat`;
  if (got.notNull !== want.notNull) return `${key}: ${nullability(got.notNull)} i databasen, ${nullability(want.notNull)} i schemat`;
  return null;
}

/** Skillnaderna, en rad per kolumn. Tabeller som bara migrationerna har ignoreras (`ignoreTables`). */
export function schemaDrift(expected: ColumnMap, actual: ColumnMap, ignoreTables: ReadonlySet<string> = new Set()): string[] {
  const missingOrWrong = [...expected].map(([key, want]) => columnDrift(key, want, actual.get(key)));
  const extra = [...actual.keys()]
    .filter((key) => !expected.has(key) && !ignoreTables.has(key.split(".")[0] ?? ""))
    .map((key) => `${key}: finns i databasen men inte i schemat`);
  return [...missingOrWrong.filter((d): d is string => d !== null), ...extra];
}

interface InfoColumn { table_name: string; column_name: string; data_type: string; is_nullable: string }

/** Kolumnerna efter att alla migrationer applicerats på en tom databas. */
export async function migratedColumns(migrations: readonly Migration[] = migrationFiles()): Promise<Map<string, ColumnShape>> {
  const client = new PGlite();
  try {
    for (const m of migrations) await client.exec(m.sql);
    const { rows } = await client.query<InfoColumn>(
      "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = current_schema()",
    );
    return new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, { type: r.data_type, notNull: r.is_nullable === "NO" }]));
  } finally {
    await client.close();
  }
}

/** Alla fel, tomt om migrationerna är i ordning. */
export async function checkMigrations(migrations: readonly Migration[] = migrationFiles()): Promise<string[]> {
  const files = migrations.map((m) => m.filename);
  const naming = [
    ...misnamedMigrations(files).map((f) => `felaktigt namn: ${f} (förväntat NNNN_namn.sql)`),
    ...duplicateMigrationNumbers(files).map((d) => `samma nummer: ${d}`),
  ];
  if (naming.length > 0) return naming;
  return schemaDrift(expectedColumns(), await migratedColumns(migrations));
}

if (import.meta.main) {
  const problems = await checkMigrations();
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log("✓ migrationerna har unika nummer och matchar Drizzle-schemat");
}
