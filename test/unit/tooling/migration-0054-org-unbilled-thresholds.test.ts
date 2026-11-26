/**
 * Migration 0054 (#1911) mot en in-process Postgres (PGlite): byråns trösklar
 * för "Bör faktureras" är nullbara `integer`-kolumner utan standardvärde, en
 * befintlig byrå får NULL (= kodens standard), och migreringen går att köra
 * igen. Drizzle-schemat speglar kolumnerna.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { organizations } from "@/lib/server/db/schema";

const DIR = "tooling/db/migrations";
const TARGET = "0054_org_unbilled_thresholds.sql";
const ORG = "11111111-1111-4111-8111-111111111111";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

describe("migration 0054 — byråns trösklar för Bör faktureras", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå')`);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  it("kolumnerna är nullbara integer utan standardvärde", async () => {
    const { rows } = await pg.query(`
      SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'organizations' AND column_name IN ('unbilled_threshold_ore', 'unbilled_age_days')
      ORDER BY column_name`);
    expect(rows).toEqual([
      { column_name: "unbilled_age_days", data_type: "integer", is_nullable: "YES", column_default: null },
      { column_name: "unbilled_threshold_ore", data_type: "integer", is_nullable: "YES", column_default: null },
    ]);
  });

  it("en befintlig byrå får NULL, och migreringen går att köra igen", async () => {
    await pg.exec(sqlOf(TARGET));
    const { rows } = await pg.query(`SELECT unbilled_threshold_ore, unbilled_age_days FROM organizations WHERE id = '${ORG}'`);
    expect(rows).toEqual([{ unbilled_threshold_ore: null, unbilled_age_days: null }]);
  });

  it("märkt expand (ADR 0019)", () => {
    expect(sqlOf(TARGET).split("\n")[0]).toBe("-- kind: expand");
  });

  it("Drizzle-schemat speglar kolumnerna", () => {
    const cols = getTableColumns(organizations);
    expect([cols.unbilledThresholdOre.name, cols.unbilledThresholdOre.notNull]).toEqual(["unbilled_threshold_ore", false]);
    expect([cols.unbilledAgeDays.name, cols.unbilledAgeDays.notNull]).toEqual(["unbilled_age_days", false]);
  });
});
