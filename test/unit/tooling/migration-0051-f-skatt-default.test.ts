/**
 * Migration 0051 (#1675) mot en in-process Postgres (PGlite): F-skatt är normen.
 * Ett ärende som fick false av det gamla standardvärdet blir true, får ny
 * version och en change_log-rad (klienternas cache hämtar det igen), nya
 * ärenden får true, och migreringen går att köra igen utan nya ändringar.
 * Drizzle-schemat har samma standardvärde som databasen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { matters } from "@/lib/server/db/schema";

const DIR = "tooling/db/migrations";
const TARGET = "0051_matter_f_skatt_default.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const LIVE = "22222222-2222-4222-8222-222222222222";
const DELETED = "33333333-3333-4333-8333-333333333333";
const NEW = "44444444-4444-4444-8444-444444444444";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

describe("migration 0051 — F-skatt är standard för ärenden", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO matters (id, organization_id, matter_number, title) VALUES
        ('${LIVE}', '${ORG}', '2026-1', 'Levande'), ('${DELETED}', '${ORG}', '2026-2', 'Raderad');
      UPDATE matters SET deleted_at = now() WHERE id = '${DELETED}';
    `);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  const matter = async (id: string) =>
    (await pg.query<{ taxa_has_f_tax: boolean; version: number }>(`SELECT taxa_has_f_tax, version FROM matters WHERE id = '${id}'`)).rows[0];

  it("det gamla standardvärdet false blir true, med ny version", async () => {
    expect(await matter(LIVE)).toEqual({ taxa_has_f_tax: true, version: 2 });
    expect((await matter(DELETED))?.taxa_has_f_tax).toBe(true);
  });

  it("klienterna får veta: change_log för levande ärenden, inte raderade", async () => {
    const { rows } = await pg.query(`SELECT entity, row_id, version, op FROM change_log ORDER BY row_id`);
    expect(rows).toEqual([{ entity: "matter", row_id: LIVE, version: 2, op: "update" }]);
  });

  it("ett nytt ärende får true; migreringen går att köra igen utan nya ändringar", async () => {
    await pg.exec(`INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${NEW}', '${ORG}', '2026-3', 'Ny')`);
    expect((await matter(NEW))?.taxa_has_f_tax).toBe(true);
    await pg.exec(sqlOf(TARGET));
    expect((await pg.query(`SELECT 1 FROM change_log`)).rows).toHaveLength(1);
  });

  it("Drizzle-schemat har samma standardvärde som databasen", () => {
    expect(getTableColumns(matters).taxaHasFTax.default).toBe(true);
  });
});
