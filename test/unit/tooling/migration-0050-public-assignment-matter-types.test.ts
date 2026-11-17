/**
 * Migration 0050 (#1638) mot en in-process Postgres (PGlite): additiv, nullable
 * kolumn. Befintliga byråer får NULL (aldrig satt); migrationen tål att köras igen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const DIR = "tooling/db/migrations";
const TARGET = "0050_public_assignment_matter_types.sql";
const MIGRATION = readFileSync(`${DIR}/${TARGET}`, "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.filter((name) => name < TARGET)) await pg.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  await pg.exec(`INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');`);
  await pg.exec(MIGRATION);
});

afterAll(async () => { await pg.close(); });

const markedOf = async (): Promise<unknown> =>
  (await pg.query<{ m: unknown }>(`SELECT public_assignment_matter_types AS m FROM organizations WHERE id = $1`, [ORG])).rows[0]?.m;

describe("migration 0050 — offentligt uppdrag per ärendetyp", () => {
  it("en befintlig byrå får NULL (aldrig satt)", async () => {
    expect(await markedOf()).toBeNull();
  });

  it("kolumnen tar en lista och kan sättas tillbaka till NULL", async () => {
    await pg.query(`UPDATE organizations SET public_assignment_matter_types = $1::jsonb WHERE id = $2`, [JSON.stringify(["Målsägandebiträde"]), ORG]);
    expect(await markedOf()).toEqual(["Målsägandebiträde"]);
    await pg.query(`UPDATE organizations SET public_assignment_matter_types = NULL WHERE id = $1`, [ORG]);
    expect(await markedOf()).toBeNull();
  });

  it("är additiv och kan köras igen", async () => {
    expect(MIGRATION).not.toMatch(/\b(DROP|RENAME|TRUNCATE|DELETE)\b/i);
    await pg.exec(MIGRATION);
    expect(await markedOf()).toBeNull();
  });
});
