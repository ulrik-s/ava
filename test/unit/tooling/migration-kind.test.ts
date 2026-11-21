/**
 * Expand eller contract (#1770): märkningen på migrationerna, vad som räknas
 * som destruktivt, och planen som deployen läser för att avgöra om servern
 * kan backas automatiskt.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "bun:test";
import { applyMigrations, type MigrationClient, planMigrations, planSummary, renderPlan } from "../../../tooling/scripts/db-migrate";
import {
  CLASSIFIED_FROM, declaredKind, deployKind, destructiveStatements, kindProblems, migrationNumber,
} from "../../../tooling/scripts/lib/migration-kind";

const why = (sql: string): string[] => destructiveStatements(sql).map((d) => d.split(":")[0] ?? "");

describe("märkningen", () => {
  it("läses från första raden, oavsett skiftläge", () => {
    expect(declaredKind("-- kind: expand\nALTER TABLE x ADD COLUMN y text;")).toBe("expand");
    expect(declaredKind("--kind: CONTRACT\n")).toBe("contract");
    expect(declaredKind("ALTER TABLE x ADD y text;\n-- kind: expand")).toBeNull();
    expect(declaredKind("-- kind: kanske\n")).toBeNull();
  });

  it("numret ur filnamnet", () => {
    expect(migrationNumber("0052_x.sql")).toBe(52);
    expect(migrationNumber("x.sql")).toBeNull();
  });

  it("vid deploy räknas en omärkt migration som contract", () => {
    expect(deployKind("-- kind: expand\nSELECT 1")).toBe("expand");
    expect(deployKind("SELECT 1")).toBe("contract");
  });
});

describe("destruktiv SQL", () => {
  it("det som lägger till är expand", () => {
    expect(destructiveStatements(`
      ALTER TABLE matters ADD COLUMN note text;
      ALTER TABLE matters ADD COLUMN f_skatt boolean NOT NULL DEFAULT true;
      ALTER TABLE matters ADD COLUMN total integer GENERATED ALWAYS AS (a + b) STORED NOT NULL;
      ALTER TABLE matters ALTER COLUMN note DROP NOT NULL;
      ALTER TABLE matters DROP CONSTRAINT old_check;
      CREATE INDEX matters_note_idx ON matters (note);
      DROP INDEX IF EXISTS old_idx;
      ALTER TYPE matter_kind ADD VALUE 'ny';
      UPDATE matters SET note = '' WHERE note IS NULL;
      INSERT INTO settings (k) VALUES ('x');
    `)).toEqual([]);
  });

  it("allt på en tabell som skapas i samma migration är nytt och ofarligt", () => {
    expect(destructiveStatements(`
      CREATE TABLE IF NOT EXISTS "public"."kinds" (id text PRIMARY KEY, name text NOT NULL);
      ALTER TABLE "kinds" ADD CONSTRAINT kinds_name_uq UNIQUE (name);
      ALTER TABLE kinds ADD COLUMN code text NOT NULL;
      CREATE UNIQUE INDEX kinds_code_uq ON kinds (code);
    `)).toEqual([]);
  });

  it("det som tar bort, döper om, byter typ eller skärper är contract", () => {
    expect(why("ALTER TABLE users DROP COLUMN public_keys")).toEqual(["tar bort en kolumn"]);
    expect(why("ALTER TABLE users ALTER COLUMN role DROP DEFAULT")).toEqual(["tar bort ett default"]);
    expect(why("ALTER TABLE users RENAME COLUMN a TO b")).toEqual(["döper om"]);
    expect(why("ALTER TABLE runs ALTER COLUMN awarded_ore TYPE bigint")).toEqual(["byter typ"]);
    expect(why("ALTER TABLE runs ALTER COLUMN x SET NOT NULL")).toEqual(["skärper till NOT NULL"]);
    expect(why("ALTER TABLE runs ADD CONSTRAINT x CHECK (a > 0)")).toEqual(["lägger till en constraint"]);
    expect(why("ALTER TABLE runs ADD COLUMN y text NOT NULL")).toEqual(["lägger till en NOT NULL-kolumn utan default"]);
    expect(why("DROP TABLE old_things")).toEqual(["tar bort ett objekt"]);
    expect(why("ALTER TYPE kind RENAME VALUE 'a' TO 'b'")).toEqual(["ändrar en enum"]);
    expect(why("DELETE FROM sessions")).toEqual(["tar bort data"]);
    expect(why("TRUNCATE sessions")).toEqual(["tar bort data"]);
    expect(why("CREATE UNIQUE INDEX users_email_uq ON users (email)")).toEqual(["lägger till ett unikt index"]);
  });

  it("procedurkod som kör SQL vi inte kan läsa räknas som contract; funktionskroppar delar inte satser", () => {
    expect(why("DO $$ BEGIN CREATE UNIQUE INDEX u ON users (email); END $$;")[0]).toBe("innehåller procedurkod (DO-block eller dynamisk EXECUTE) som inte kan granskas automatiskt");
    expect(why("SELECT 1; EXECUTE format('ALTER TABLE %I DROP x', 't');").length).toBeGreaterThan(0);
    expect(destructiveStatements(`CREATE OR REPLACE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN DELETE FROM cache; RETURN NULL; END $fn$;`)).toEqual([]);
  });

  it("kommentarer räknas inte, och långa satser kortas i beskedet", () => {
    expect(destructiveStatements("-- DROP TABLE x\n/* DELETE FROM y */ SELECT 1")).toEqual([]);
    const long = destructiveStatements(`DELETE FROM t WHERE ${"x = 1 AND ".repeat(20)}y = 2`)[0] ?? "";
    expect(long.endsWith("...")).toBe(true);
  });
});

describe("kontrollen av märkningen", () => {
  it("äldre migrationer än 0052 granskas inte", () => {
    expect(CLASSIFIED_FROM).toBe(52);
    expect(kindProblems("0051_x.sql", "DROP TABLE x")).toEqual([]);
    expect(kindProblems("felnamn.sql", "DROP TABLE x")).toEqual([]);
  });

  it("från 0052: märkning krävs, och en expand får inte vara destruktiv", () => {
    expect(kindProblems("0052_x.sql", "ALTER TABLE a ADD b text")).toEqual(["0052_x.sql: saknar `-- kind: expand` eller `-- kind: contract` på första raden"]);
    expect(kindProblems("0052_x.sql", "-- kind: expand\nALTER TABLE a ADD b text")).toEqual([]);
    expect(kindProblems("0052_x.sql", "-- kind: contract\nDROP TABLE a")).toEqual([]);
    expect(kindProblems("0052_x.sql", "-- kind: expand\nDROP TABLE a")[0]).toContain("märkt expand men tar bort ett objekt");
  });
});

describe("planen som deployen läser", () => {
  const adapt = (db: PGlite): MigrationClient => ({ unsafe: async (q) => (await db.exec(q)).at(-1)?.rows ?? [] });

  it("bara väntande migrationer, med sin art; contract om någon är det", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-plan-"));
    writeFileSync(join(dir, "0000_init.sql"), "CREATE TABLE organizations (id text PRIMARY KEY);");
    const pg = new PGlite();
    try {
      const client = adapt(pg);
      await applyMigrations(client, { dir });
      expect(await planMigrations(client, dir)).toEqual([]);
      writeFileSync(join(dir, "0052_add.sql"), "-- kind: expand\nALTER TABLE organizations ADD COLUMN name text;");
      writeFileSync(join(dir, "0053_drop.sql"), "-- kind: contract\nALTER TABLE organizations DROP COLUMN name;");
      const pending = await planMigrations(client, dir);
      expect(pending).toEqual([{ filename: "0052_add.sql", kind: "expand" }, { filename: "0053_drop.sql", kind: "contract" }]);
      expect(renderPlan(pending)).toBe("väntande: 0052_add.sql (expand)\nväntande: 0053_drop.sql (contract)\nplan: contract");
    } finally {
      await pg.close();
    }
  });

  it("sammanfattningen: none utan väntande, expand när alla lägger till", () => {
    expect(planSummary([])).toBe("none");
    expect(planSummary([{ filename: "0052_a.sql", kind: "expand" }])).toBe("expand");
    expect(renderPlan([])).toBe("plan: none");
  });
});
