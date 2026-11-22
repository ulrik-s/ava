/**
 * Migration 0052 (#1818) mot en in-process Postgres (PGlite): jävskontrollens
 * logg får ett ärende-id med index, och ärendet två nullbara listor med
 * träffar. Befintliga rader får null, och migrationen går att köra igen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { declaredKind } from "../../../tooling/scripts/lib/migration-kind";

const DIR = "tooling/db/migrations";
const TARGET = "0052_conflict_check_matter.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const CHECK = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

describe("migration 0052 — jävskontrollen kopplas till ärendet", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${MATTER}', '${ORG}', '2026-1', 'Tvist');
      INSERT INTO conflict_checks (id, search_term, search_type, checked_by_id)
        VALUES ('${CHECK}', 'Bo', 'name', '${USER}');
    `);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  const column = async (table: string, name: string) =>
    (await pg.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${name}'`,
    )).rows[0];

  it("är märkt som expand", () => {
    expect(declaredKind(sqlOf(TARGET))).toBe("expand");
  });

  it("kolumnerna finns, nullbara och utan standardvärde", async () => {
    expect(await column("conflict_checks", "matter_id")).toEqual({ data_type: "uuid", is_nullable: "YES", column_default: null });
    expect(await column("matters", "conflict_check_results")).toEqual({ data_type: "jsonb", is_nullable: "YES", column_default: null });
    expect(await column("matters", "conflict_reviewed_hits")).toEqual({ data_type: "jsonb", is_nullable: "YES", column_default: null });
  });

  it("indexet på ärendet finns", async () => {
    const { rows } = await pg.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'conflict_checks' AND indexname = 'conflict_checks_matter_idx'`);
    expect(rows).toHaveLength(1);
  });

  it("befintliga rader får null", async () => {
    expect((await pg.query(`SELECT matter_id FROM conflict_checks WHERE id = '${CHECK}'`)).rows).toEqual([{ matter_id: null }]);
    expect((await pg.query(`SELECT conflict_check_results, conflict_reviewed_hits FROM matters WHERE id = '${MATTER}'`)).rows)
      .toEqual([{ conflict_check_results: null, conflict_reviewed_hits: null }]);
  });

  it("migrationen går att köra två gånger", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await column("conflict_checks", "matter_id")).toBeDefined();
  });
});
