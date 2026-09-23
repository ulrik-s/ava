/**
 * `db:migrate`-spårningen (#1107) mot en in-process Postgres (PGlite): bara nya
 * filer körs, en trasig fil lämnar inget efter sig, och en otrackad befintlig
 * databas vägras tills `--baseline`.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { applyMigrations, migrationFiles, type MigrationClient } from "../../../tooling/scripts/db-migrate";

let pg: PGlite;
let client: MigrationClient;
let dir: string;

/** PGlite:s `exec` kör multi-statement-strängar som postgres.js `unsafe`. */
const adapt = (db: PGlite): MigrationClient => ({
  unsafe: async (q) => (await db.exec(q)).at(-1)?.rows ?? [],
});

const write = (name: string, sql: string): void => writeFileSync(join(dir, name), sql);
const tables = async (): Promise<string[]> =>
  (await pg.query<{ t: string }>(
    `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
  )).rows.map((r) => r.t);

beforeEach(() => {
  pg = new PGlite();
  client = adapt(pg);
  dir = mkdtempSync(join(tmpdir(), "ava-migrate-"));
  write("0000_init.sql", `CREATE TABLE organizations (id text PRIMARY KEY);`);
});

afterEach(async () => {
  await pg.close();
});

describe("applyMigrations", () => {
  it("kör alla filer på en tom databas och spårar dem", async () => {
    write("0001_more.sql", `CREATE TABLE users (id text);`);
    expect(await applyMigrations(client, { dir })).toBe(2);
    expect(await tables()).toEqual(["organizations", "schema_migrations", "users"]);
  });

  it("omkörning applicerar bara nya filer (fallerade förr på 'already exists')", async () => {
    await applyMigrations(client, { dir });
    expect(await applyMigrations(client, { dir })).toBe(0);
    write("0001_more.sql", `CREATE TABLE users (id text);`);
    expect(await applyMigrations(client, { dir })).toBe(1);
  });

  it("en trasig fil rullas tillbaka helt och spåras inte", async () => {
    await applyMigrations(client, { dir });
    write("0001_broken.sql", `CREATE TABLE half (id text); SELECT nope_no_such_column FROM organizations;`);
    await expect(applyMigrations(client, { dir })).rejects.toThrow("0001_broken.sql");
    expect(await tables()).not.toContain("half");
    // Fixad fil körs nästa gång — den var aldrig markerad som körd.
    write("0001_broken.sql", `CREATE TABLE half (id text);`);
    expect(await applyMigrations(client, { dir })).toBe(1);
  });

  it("vägrar en otrackad databas som redan har schemat", async () => {
    await pg.exec(`CREATE TABLE organizations (id text PRIMARY KEY);`);
    await expect(applyMigrations(client, { dir })).rejects.toThrow("--baseline");
  });

  it("--baseline markerar nuvarande filer utan att köra dem; nya körs sedan", async () => {
    await pg.exec(`CREATE TABLE organizations (id text PRIMARY KEY);`);
    expect(await applyMigrations(client, { dir, baseline: true })).toBe(1);
    write("0001_more.sql", `CREATE TABLE users (id text);`);
    expect(await applyMigrations(client, { dir })).toBe(1);
    expect(await tables()).toContain("users");
  });
});

describe("migrationFiles", () => {
  it("sorterar lexikografiskt och ignorerar icke-sql", () => {
    write("0002_c.sql", "");
    write("0001_b.sql", "");
    write("notes.md", "");
    expect(migrationFiles(dir).map((m) => m.filename)).toEqual(["0000_init.sql", "0001_b.sql", "0002_c.sql"]);
  });

  it("vägrar filnamn som inte kan inlinas säkert i SQL", () => {
    write("0001_it's.sql", "");
    expect(() => migrationFiles(dir)).toThrow("ogiltigt migrationsnamn");
  });

  it("de riktiga migrationerna har giltiga namn", () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });
});
