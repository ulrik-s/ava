/**
 * Migration 0039 (#1379) mot en in-process Postgres (PGlite): registret över
 * KR-referenser fylls med befintliga referenser, en historisk dubblett fäller
 * INTE migreringen (den rapporteras som en NOTICE), nya dubbletter vägras och
 * migreringen går att köra igen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const DIR = "tooling/db/migrations";
const TARGET = "0039_kr_references.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MATTER = "33333333-3333-4333-8333-333333333333";
const OTHER_MATTER = "44444444-4444-4444-8444-444444444444";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

const matter = (id: string, org: string): string =>
  `INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${id}', '${org}', '2026-0001', 'Ärende')`;
const run = (id: string, matterId: string, reference: string | null, createdAt: string): string =>
  `INSERT INTO billing_runs (id, matter_id, type, recipient, work_value_ore_at_run, proposed_amount_ore, amount_ore, reference, created_at)
   VALUES ('${id}', '${matterId}', 'KOSTNADSRAKNING', 'DOMSTOL', 0, 0, 0, ${reference ? `'${reference}'` : "NULL"}, '${createdAt}')`;

describe("migration 0039 — register över KR-referenser", () => {
  let pg: PGlite;
  const notices: string[] = [];

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(matter(MATTER, ORG));
    await pg.exec(matter(OTHER_MATTER, OTHER));
    await pg.exec(run("a0000000-0000-4000-8000-000000000001", MATTER, "KR-2026-0001", "2026-01-01T10:00:00Z"));
    // Historisk dubblett (buggen i #1379) — den äldsta körningen registreras.
    await pg.exec(run("a0000000-0000-4000-8000-000000000002", MATTER, "KR-2026-0002", "2026-01-02T10:00:00Z"));
    await pg.exec(run("a0000000-0000-4000-8000-000000000003", MATTER, "KR-2026-0002", "2026-01-02T10:00:01Z"));
    await pg.exec(run("a0000000-0000-4000-8000-000000000004", OTHER_MATTER, "KR-2026-0001", "2026-01-03T10:00:00Z"));
    await pg.exec(run("a0000000-0000-4000-8000-000000000005", MATTER, null, "2026-01-04T10:00:00Z"));
    await pg.exec(sqlOf(TARGET), { onNotice: (n) => notices.push(n.message ?? "") });
  });
  afterAll(async () => { await pg.close(); });

  it("befintliga referenser förs in per byrå — dubbletten en gång, den äldsta körningen", async () => {
    const { rows } = await pg.query<{ organization_id: string; reference: string; billing_run_id: string }>(
      `SELECT organization_id, reference, billing_run_id FROM kr_references ORDER BY organization_id, reference`);
    expect(rows).toEqual([
      { organization_id: ORG, reference: "KR-2026-0001", billing_run_id: "a0000000-0000-4000-8000-000000000001" },
      { organization_id: ORG, reference: "KR-2026-0002", billing_run_id: "a0000000-0000-4000-8000-000000000002" },
      { organization_id: OTHER, reference: "KR-2026-0001", billing_run_id: "a0000000-0000-4000-8000-000000000004" },
    ]);
  });

  it("dubbletten fäller inte migreringen utan rapporteras som en NOTICE med referensen", () => {
    expect(notices.some((n) => n.includes("kr_references") && n.includes(`${ORG} KR-2026-0002 (2 st)`))).toBe(true);
  });

  it("en ny dubblett inom byrån vägras — samma referens i en annan byrå går bra", async () => {
    await expect(pg.exec(`INSERT INTO kr_references (organization_id, reference, billing_run_id)
      VALUES ('${ORG}', 'KR-2026-0001', 'a0000000-0000-4000-8000-000000000009')`)).rejects.toThrow(/kr_references_pk/);
    await pg.exec(`INSERT INTO kr_references (organization_id, reference, billing_run_id)
      VALUES ('${OTHER}', 'KR-2026-0002', 'a0000000-0000-4000-8000-000000000009')`);
  });

  it("kan köras igen utan att något ändras", async () => {
    await pg.exec(sqlOf(TARGET));
    expect((await pg.query(`SELECT 1 FROM kr_references`)).rows).toHaveLength(4);
  });
});
