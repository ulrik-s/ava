/**
 * Migration 0058 (#2214, ADR 0040 §3) mot en in-process Postgres (PGlite):
 * contract-steget för frister i kalendern.
 *
 * - Levande och mjukraderade `kind = 'deadline'`-rader raderas; möten står kvar.
 * - En tombstone (`calendarEvent`/`delete`/version + 1) per levande raderad rad,
 *   ingen för mjukraderade (de har redan sin).
 * - Omkörning ändrar inget, och migreringskontrollen ser raderingen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { declaredKind, destructiveStatements, kindProblems } from "../../../tooling/scripts/lib/migration-kind";

const DIR = "tooling/db/migrations";
const TARGET = "0058_calendar_deadline_contract.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DEADLINE = id(1);
const DEADLINE_V3 = id(2);
const DEADLINE_DELETED = id(3);
const MEETING = id(4);
const MEETING_DELETED = id(5);

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

function eventRow(rowId: string, kind: string, version: number): string {
  return `('${rowId}', '${ORG}', '${USER}', '${kind}', 'Händelse', now(), ${version})`;
}

describe("migration 0058 — frister i kalendern raderas (contract)", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO calendar_events (id, organization_id, user_id, kind, title, start_at, version) VALUES
        ${[eventRow(DEADLINE, "deadline", 1), eventRow(DEADLINE_V3, "deadline", 3),
          eventRow(DEADLINE_DELETED, "deadline", 2), eventRow(MEETING, "appointment", 1),
          eventRow(MEETING_DELETED, "appointment", 1)].join(",\n")};
      UPDATE calendar_events SET deleted_at = now() WHERE id IN ('${DEADLINE_DELETED}', '${MEETING_DELETED}');
    `);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  const remaining = async () => (await pg.query<{ id: string }>(
    `SELECT id FROM calendar_events ORDER BY id`)).rows.map((r) => r.id);
  const changeLog = async () => (await pg.query<{ organization_id: string; entity: string; row_id: string; version: number; op: string }>(
    `SELECT organization_id, entity, row_id, version, op FROM change_log ORDER BY row_id`)).rows;

  it("är en contract, och kontrollen ser raderingen", () => {
    expect(declaredKind(sqlOf(TARGET))).toBe("contract");
    expect(destructiveStatements(sqlOf(TARGET))).toEqual([
      expect.stringContaining("DELETE FROM calendar_events WHERE kind = 'deadline'"),
    ]);
    expect(kindProblems(TARGET, sqlOf(TARGET))).toEqual([]);
  });

  it("levande och mjukraderade frister raderas, möten står kvar", async () => {
    expect(await remaining()).toEqual([MEETING, MEETING_DELETED]);
  });

  it("en tombstone per levande raderad frist, med nästa version, ingen för mjukraderade", async () => {
    expect(await changeLog()).toEqual([
      { organization_id: ORG, entity: "calendarEvent", row_id: DEADLINE, version: 2, op: "delete" },
      { organization_id: ORG, entity: "calendarEvent", row_id: DEADLINE_V3, version: 4, op: "delete" },
    ]);
  });

  it("en omkörning ändrar ingenting", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await remaining()).toEqual([MEETING, MEETING_DELETED]);
    expect(await changeLog()).toHaveLength(2);
  });
});
