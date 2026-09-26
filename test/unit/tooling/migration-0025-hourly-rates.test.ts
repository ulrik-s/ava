/**
 * Migration 0025 (#1206) mot en in-process Postgres (PGlite): de gamla
 * enkelpris-kolumnerna flyttas in i `hourly_rates`-kartorna, kolumnerna tas
 * bort och flyttade rader får ny version + en change_log-rad (klienternas cache
 * hämtar dem igen).
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const DIR = "tooling/db/migrations";
const TARGET = "0025_hourly_rates_per_kind.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const ORG_EMPTY = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const USER_NEG = "44444444-4444-4444-8444-444444444444";
const MATTER = "55555555-5555-4555-8555-555555555555";
const MATTER_NONE = "66666666-6666-4666-8666-666666666666";

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.filter((name) => name < TARGET)) await pg.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  await pg.exec(`
    INSERT INTO organizations (id, name, default_hourly_rate, tidsspillan_hourly_rate) VALUES
      ('${ORG}', 'Byrå', 250000, 148700), ('${ORG_EMPTY}', 'Tom byrå', NULL, NULL);
    INSERT INTO users (id, organization_id, email, name, hourly_rate) VALUES
      ('${USER}', '${ORG}', 'a@x', 'Anna', 300000), ('${USER_NEG}', '${ORG}', 'b@x', 'Bo', -5);
    INSERT INTO matters (id, organization_id, matter_number, title, hourly_rate) VALUES
      ('${MATTER}', '${ORG}', '2026-1', 'T', 400000), ('${MATTER_NONE}', '${ORG}', '2026-2', 'U', NULL);
  `);
  await pg.exec(readFileSync(`${DIR}/${TARGET}`, "utf8"));
});

afterAll(async () => { await pg.close(); });

const ratesOf = async (table: string, id: string): Promise<unknown> =>
  (await pg.query<{ hourly_rates: unknown }>(`SELECT hourly_rates FROM ${table} WHERE id = $1`, [id])).rows[0]?.hourly_rates;

describe("migration 0025 — timpris per kategori", () => {
  it("byråns standard → ARBETE, byråns tidsspillan → TIDSSPILLAN", async () => {
    expect(await ratesOf("organizations", ORG)).toEqual({ ARBETE: 250000, TIDSSPILLAN: 148700 });
    expect(await ratesOf("organizations", ORG_EMPTY)).toEqual({});
  });

  it("juristens och ärendets pris → ARBETE; negativt pris följer inte med", async () => {
    expect(await ratesOf("users", USER)).toEqual({ ARBETE: 300000 });
    expect(await ratesOf("users", USER_NEG)).toEqual({});
    expect(await ratesOf("matters", MATTER)).toEqual({ ARBETE: 400000 });
    expect(await ratesOf("matters", MATTER_NONE)).toEqual({});
  });

  it("de gamla kolumnerna är borta", async () => {
    const cols = await pg.query<{ c: string }>(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
       WHERE table_name IN ('organizations', 'users', 'matters') AND column_name LIKE '%hourly_rate%' ORDER BY 1`,
    );
    expect(cols.rows.map((r) => r.c)).toEqual(["matters.hourly_rates", "organizations.hourly_rates", "users.hourly_rates"]);
  });

  it("flyttade rader får ny version och en change_log-rad; orörda rader inte", async () => {
    const log = await pg.query<{ entity: string; row_id: string; version: number; op: string }>(
      `SELECT entity, row_id, version, op FROM change_log ORDER BY entity, row_id`,
    );
    expect(log.rows).toEqual([
      { entity: "matter", row_id: MATTER, version: 2, op: "update" },
      { entity: "organization", row_id: ORG, version: 2, op: "update" },
      { entity: "user", row_id: USER, version: 2, op: "update" },
    ]);
    const untouched = await pg.query<{ version: number }>(`SELECT version FROM matters WHERE id = $1`, [MATTER_NONE]);
    expect(untouched.rows[0]?.version).toBe(1);
  });

  it("nya rader får en tom karta som default", async () => {
    await pg.exec(`INSERT INTO organizations (id, name) VALUES ('77777777-7777-4777-8777-777777777777', 'Ny')`);
    expect(await ratesOf("organizations", "77777777-7777-4777-8777-777777777777")).toEqual({});
  });
});
