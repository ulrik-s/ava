/**
 * Migration 0035 (#1345) mot en in-process Postgres (PGlite): tidsposter och
 * utlägg får en främmande nyckel mot ärendet. Befintliga föräldralösa rader
 * fäller inte migreringen och raderas inte — nyckeln lämnas då ovaliderad
 * (men gäller för nya rader), och valideras där tabellen är ren.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const DIR = "tooling/db/migrations";
const TARGET = "0035_time_entry_expense_matter_fk.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const MATTER = "55555555-5555-4555-8555-555555555555";
const GONE = "66666666-6666-4666-8666-666666666666";
const ORPHAN_ENTRY = "77777777-7777-4777-8777-777777777777";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

async function migrated(pred: (f: string) => boolean): Promise<PGlite> {
  const pg = new PGlite();
  for (const f of files.filter(pred)) await pg.exec(sqlOf(f));
  return pg;
}

async function validated(pg: PGlite, con: string): Promise<boolean | undefined> {
  return (await pg.query<{ convalidated: boolean }>(`SELECT convalidated FROM pg_constraint WHERE conname = $1`, [con])).rows[0]?.convalidated;
}

const entry = (id: string, matterId: string): string =>
  `INSERT INTO time_entries (id, user_id, matter_id, date, minutes, description, hourly_rate)
   VALUES ('${id}', '${USER}', '${matterId}', now(), 60, 'x', 1000)`;
const expense = (id: string, matterId: string): string =>
  `INSERT INTO expenses (id, user_id, matter_id, date, amount, description) VALUES ('${id}', '${USER}', '${matterId}', now(), 100, 'x')`;

describe("migration 0035 — främmande nyckel tid/utlägg → ärende", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await migrated((f) => f < TARGET);
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${MATTER}', '${ORG}', '2026-1', 'T');
      ${entry("88888888-8888-4888-8888-888888888888", MATTER)};
      ${entry(ORPHAN_ENTRY, GONE)};
      ${expense("99999999-9999-4999-8999-999999999999", MATTER)};
    `);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  it("en föräldralös tidspost fäller inte migreringen och raderas inte — nyckeln lämnas ovaliderad", async () => {
    expect((await pg.query(`SELECT id FROM time_entries WHERE id = $1`, [ORPHAN_ENTRY])).rows).toHaveLength(1);
    expect(await validated(pg, "time_entries_matter_id_fk")).toBe(false);
  });

  it("en ren tabell får en validerad nyckel", async () => {
    expect(await validated(pg, "expenses_matter_id_fk")).toBe(true);
  });

  it("nyckeln gäller för nya rader i båda tabellerna, även den ovaliderade", async () => {
    await expect(pg.exec(entry("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", GONE))).rejects.toThrow(/time_entries_matter_id_fk/);
    await expect(pg.exec(expense("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", GONE))).rejects.toThrow(/expenses_matter_id_fk/);
    await pg.exec(entry("cccccccc-cccc-4ccc-8ccc-cccccccccccc", MATTER));
  });

  it("kan köras igen: rättade rader → nyckeln valideras", async () => {
    await pg.exec(`DELETE FROM time_entries WHERE id = '${ORPHAN_ENTRY}'`);
    await pg.exec(sqlOf(TARGET));
    expect(await validated(pg, "time_entries_matter_id_fk")).toBe(true);
  });

  it("en tom databas får båda nycklarna validerade", async () => {
    const fresh = await migrated(() => true);
    try {
      expect(await validated(fresh, "time_entries_matter_id_fk")).toBe(true);
      expect(await validated(fresh, "expenses_matter_id_fk")).toBe(true);
    } finally {
      await fresh.close();
    }
  });
});
