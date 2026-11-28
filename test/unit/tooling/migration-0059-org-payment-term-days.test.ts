/**
 * Migration 0059 (#2265) mot en in-process Postgres (PGlite): byråns
 * betalningsvillkor är en nullbar `integer`-kolumn utan standardvärde, en
 * befintlig byrå får NULL (= kodens standard, tio dagar), och migreringen går
 * att köra igen. Drizzle-schemat speglar kolumnen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { organizations } from "@/lib/server/db/schema";

const DIR = "tooling/db/migrations";
const TARGET = "0059_org_payment_term_days.sql";
const ORG = "11111111-1111-4111-8111-111111111111";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

describe("migration 0059 — byråns betalningsvillkor", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå')`);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  it("kolumnen är nullbar integer utan standardvärde", async () => {
    const { rows } = await pg.query(`
      SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'organizations' AND column_name = 'payment_term_days'`);
    expect(rows).toEqual([{ column_name: "payment_term_days", data_type: "integer", is_nullable: "YES", column_default: null }]);
  });

  it("en befintlig byrå får NULL, och migreringen går att köra igen", async () => {
    await pg.exec(sqlOf(TARGET));
    const { rows } = await pg.query(`SELECT payment_term_days FROM organizations WHERE id = '${ORG}'`);
    expect(rows).toEqual([{ payment_term_days: null }]);
  });

  it("märkt expand (ADR 0019)", () => {
    expect(sqlOf(TARGET).split("\n")[0]).toBe("-- kind: expand");
  });

  it("Drizzle-schemat speglar kolumnen", () => {
    const col = getTableColumns(organizations).paymentTermDays;
    expect([col.name, col.notNull]).toEqual(["payment_term_days", false]);
  });
});
