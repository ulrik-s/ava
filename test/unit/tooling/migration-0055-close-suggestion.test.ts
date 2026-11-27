/**
 * Migration 0055 (#2098) mot en in-process Postgres (PGlite): ärendet får
 * datumet för Behåll som aktivt och dokumentet fältet för ett igenkänt slutligt
 * avgörande. Båda nullbara utan standardvärde; befintliga rader får null, och
 * migrationen går att köra igen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { declaredKind } from "../../../tooling/scripts/lib/migration-kind";

const DIR = "tooling/db/migrations";
const TARGET = "0055_close_suggestion.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

describe("migration 0055 — Behåll som aktivt och igenkänt avgörande", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${MATTER}', '${ORG}', '2026-1', 'Tvist');
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
    expect(await column("matters", "kept_active_at")).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null });
    expect(await column("documents", "final_ruling")).toEqual({ data_type: "text", is_nullable: "YES", column_default: null });
  });

  it("befintliga rader får null", async () => {
    expect((await pg.query(`SELECT kept_active_at FROM matters WHERE id = '${MATTER}'`)).rows).toEqual([{ kept_active_at: null }]);
  });

  it("migrationen går att köra två gånger", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await column("matters", "kept_active_at")).toBeDefined();
  });
});
