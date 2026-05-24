/**
 * Generate `data/prisma/schema.sqlite.prisma` från `data/prisma/schema.prisma`
 * genom att byta provider och anpassa typer som inte stöds av SQLite.
 *
 * Användning (operatör vid Tauri-byggets engångs-setup):
 *
 *     yarn tsx tooling/scripts/generate-sqlite-schema.ts
 *     yarn prisma generate --schema data/prisma/schema.sqlite.prisma
 *     DATABASE_URL="file:./ava.db" yarn prisma db push --schema data/prisma/schema.sqlite.prisma
 *
 * Resultatet är en SQLite-version av schemat som har samma modeller,
 * relationer och fält — men med:
 *   - `provider = "sqlite"`
 *   - `url = env("DATABASE_URL")` med `file:`-prefix utanför schemat
 *   - inga skillnader i Json-fält (Prisma 5+ stödjer SQLite Json native)
 *
 * Designval: vi har inte ett separat schema som drift-divergerar — det
 * här är ett bygg-skript som genererar från sanningen. Om du redigerar
 * schema.sqlite.prisma direkt skrivs den över nästa körning.
 *
 * Kända begränsningar mot Postgres-läget:
 *   - `mode: "insensitive"` i WHERE-klauser ignoreras av SQLite-adaptern.
 *     Sökningar blir case-sensitive i local-first. Workarounds:
 *       a) Lagrar lowercase-kopior i ett separat indexerat fält
 *       b) Använd Prisma raw-queries för sökning
 *       c) Skicka sökord genom `.toLowerCase()` båda sidor
 *   - SQLite har inte arbiträr stora `Int`/`BigInt` — använd `Decimal`
 *     om en kolumn riskerar > 2^53. Vi gör inte det idag.
 *   - SQLite har inte concurrent writers — Prisma serialiserar via
 *     adaptern, vilket är OK för single-user local-first.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "prisma", "schema.prisma");
const DST = join(ROOT, "prisma", "schema.sqlite.prisma");

function generate(input: string): string {
  let out = input;

  // 1. Byt provider + url-konvention
  out = out.replace(
    /datasource\s+db\s*{[\s\S]+?}/,
    `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`,
  );

  // 2. Lägg till generator-header-noteringen — så någon som öppnar filen
  //    inte börjar redigera den för hand.
  out = `// !!! AUTO-GENERATED från schema.prisma av scripts/generate-sqlite-schema.ts !!!\n// Redigera schema.prisma och kör skriptet igen istället för att ändra här.\n\n${out}`;

  return out;
}

function main(): void {
  const src = readFileSync(SRC, "utf8");
  const out = generate(src);
  writeFileSync(DST, out);
  console.log(`✓ Genererad: ${DST}`);
  console.log("  Nästa steg:");
  console.log("    DATABASE_URL=\"file:./ava.db\" yarn prisma generate --schema data/prisma/schema.sqlite.prisma");
  console.log("    DATABASE_URL=\"file:./ava.db\" yarn prisma db push --schema data/prisma/schema.sqlite.prisma");
}

if (require.main === module) main();

// Exporterad för tester
export { generate };
