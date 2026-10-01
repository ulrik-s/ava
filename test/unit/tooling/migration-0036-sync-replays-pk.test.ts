/**
 * Migration 0036 (#1353) mot en in-process Postgres (PGlite): sync_replays
 * nycklas på (organization_id, mutation_id). Befintliga utfall behålls, samma
 * mutationId får finnas i två byråer men bara en gång per byrå, och
 * migreringen går att köra igen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const DIR = "tooling/db/migrations";
const TARGET = "0036_sync_replays_org_pk.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MUTATION = "33333333-3333-4333-8333-333333333333";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

const replay = (org: string, mutationId: string = MUTATION): string =>
  `INSERT INTO sync_replays (mutation_id, organization_id, path, code_version, status)
   VALUES ('${mutationId}', '${org}', 'timeEntry.create', 'test', 'accepted')`;

async function primaryKeyColumns(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ attname: string }>(`
    SELECT a.attname FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = 'sync_replays'::regclass AND c.contype = 'p' ORDER BY k.ord`);
  return rows.map((r) => r.attname);
}

describe("migration 0036 — sync_replays nycklas på byrå + mutationId", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(replay(ORG));
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  it("befintliga utfall behålls och nyckeln är (organization_id, mutation_id)", async () => {
    expect((await pg.query(`SELECT 1 FROM sync_replays WHERE mutation_id = $1`, [MUTATION])).rows).toHaveLength(1);
    expect(await primaryKeyColumns(pg)).toEqual(["organization_id", "mutation_id"]);
  });

  it("samma mutationId i en annan byrå får sparas — men inte två gånger i samma byrå", async () => {
    await pg.exec(replay(OTHER));
    await expect(pg.exec(replay(ORG))).rejects.toThrow(/sync_replays_pk/);
  });

  it("kan köras igen utan att något ändras", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await primaryKeyColumns(pg)).toEqual(["organization_id", "mutation_id"]);
    expect((await pg.query(`SELECT 1 FROM sync_replays`)).rows).toHaveLength(2);
  });
});
