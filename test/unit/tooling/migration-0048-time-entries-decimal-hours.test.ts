/**
 * Migration 0048 (#1546) mot en in-process Postgres (PGlite): ej fakturerad
 * tid räknas om en gång till närmaste tillåtna decimaltimme. Fakturerad,
 * fryst, raderad tid och per-dygnsposter lämnas orörda. Ändrade poster får ny
 * version + en change_log-rad med ärendets organisation.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { roundToAllowedMinutes } from "@/lib/shared/time-hours";

const DIR = "tooling/db/migrations";
const TARGET = "0048_time_entries_decimal_hours.sql";
const MIGRATION = readFileSync(`${DIR}/${TARGET}`, "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const MATTER = "55555555-5555-4555-8555-555555555555";
const RUN = "77777777-7777-4777-8777-777777777777";
const INVOICE = "88888888-8888-4888-8888-888888888888";

/** Tidspostens id ur ett löpnummer: `00000000-0000-4000-8000-000000000NNN`. */
const entryId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** En databas med alla migrationer före 0048, en byrå, en jurist och ett ärende. */
async function databaseBefore(): Promise<PGlite> {
  const pg = new PGlite();
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.filter((name) => name < TARGET)) await pg.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  await pg.exec(`
    INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
    INSERT INTO users (id, organization_id, email, name) VALUES ('${USER}', '${ORG}', 'a@x', 'Anna');
    INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${MATTER}', '${ORG}', '2026-1', 'T');
  `);
  return pg;
}

interface EntrySpec {
  n: number;
  minutes: number;
  extra?: string;
  extraValue?: string;
}

async function insertEntry(pg: PGlite, e: EntrySpec): Promise<void> {
  const cols = e.extra ? `, ${e.extra}` : "";
  const vals = e.extraValue ? `, ${e.extraValue}` : "";
  await pg.exec(`
    INSERT INTO time_entries (id, user_id, matter_id, date, minutes, description, hourly_rate${cols})
    VALUES ('${entryId(e.n)}', '${USER}', '${MATTER}', '2026-05-01', ${e.minutes}, 'Arbete', 162600${vals});
  `);
}

const UNFROZEN: ReadonlyArray<[number, number]> = [[1, 37], [2, 9], [3, 3], [4, 57], [5, 90], [6, 0]];
const LEFT_ALONE: readonly EntrySpec[] = [
  { n: 10, minutes: 37, extra: "frozen_by_billing_run_id", extraValue: `'${RUN}'` },
  { n: 11, minutes: 37, extra: "invoice_id", extraValue: `'${INVOICE}'` },
  { n: 12, minutes: 37, extra: "frozen_at", extraValue: "'2026-05-02'" },
  { n: 13, minutes: 37, extra: "deleted_at", extraValue: "'2026-05-02'" },
  { n: 14, minutes: 37, extra: "kind", extraValue: "'ADVOKATBEREDSKAP'" },
];

async function rowOf(pg: PGlite, n: number): Promise<{ minutes: number; version: number } | undefined> {
  return (await pg.query<{ minutes: number; version: number }>(
    "SELECT minutes, version FROM time_entries WHERE id = $1", [entryId(n)],
  )).rows[0];
}

async function changeLog(pg: PGlite): Promise<Array<{ organization_id: string; entity: string; row_id: string; version: number; op: string }>> {
  return (await pg.query<{ organization_id: string; entity: string; row_id: string; version: number; op: string }>(
    "SELECT organization_id, entity, row_id, version, op FROM change_log ORDER BY row_id",
  )).rows;
}

describe("migration 0048 — ej fakturerad tid till tillåtna decimaltimmar", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await databaseBefore();
    for (const [n, minutes] of UNFROZEN) await insertEntry(pg, { n, minutes });
    for (const e of LEFT_ALONE) await insertEntry(pg, e);
    await pg.exec(MIGRATION);
  });

  afterAll(async () => { await pg.close(); });

  it("ofrysta poster: 37 → 36, 9 → 12, 3 → 6, 57 → 60; 90 och 0 oförändrade", async () => {
    const expected: Record<number, { minutes: number; version: number }> = {
      1: { minutes: 36, version: 2 }, 2: { minutes: 12, version: 2 }, 3: { minutes: 6, version: 2 },
      4: { minutes: 60, version: 2 }, 5: { minutes: 90, version: 1 }, 6: { minutes: 0, version: 1 },
    };
    for (const [n] of UNFROZEN) expect(await rowOf(pg, n)).toEqual(expected[n]);
  });

  it("fakturerad, fryst, raderad tid och per-dygnsposter är orörda", async () => {
    for (const e of LEFT_ALONE) expect(await rowOf(pg, e.n)).toEqual({ minutes: 37, version: 1 });
  });

  it("varje ändrad post får exakt en change_log-rad med ärendets organisation", async () => {
    expect(await changeLog(pg)).toEqual([1, 2, 3, 4].map((n) => ({
      organization_id: ORG, entity: "timeEntry", row_id: entryId(n), version: 2, op: "update",
    })));
  });

  it("en andra körning ändrar ingenting", async () => {
    await pg.exec(MIGRATION);
    expect(await rowOf(pg, 1)).toEqual({ minutes: 36, version: 2 });
    expect(await changeLog(pg)).toHaveLength(4);
  });
});

describe("migration 0048 — samma regel som roundToAllowedMinutes", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await databaseBefore();
    await pg.exec(`
      INSERT INTO time_entries (id, user_id, matter_id, date, minutes, description, hourly_rate)
      SELECT ('00000000-0000-4000-8000-' || lpad(m::text, 12, '0'))::uuid, '${USER}', '${MATTER}', '2026-05-01', m, 'Arbete', 162600
      FROM generate_series(0, 600) AS m;
    `);
    await pg.exec(MIGRATION);
  });

  afterAll(async () => { await pg.close(); });

  it("SQL-regeln och den gemensamma avrundningen ger samma resultat för 0–600 minuter", async () => {
    const rows = (await pg.query<{ id: string; minutes: number }>("SELECT id, minutes FROM time_entries ORDER BY id")).rows;
    expect(rows).toHaveLength(601);
    const expected = rows.map((_, m) => roundToAllowedMinutes(m));
    expect(rows.map((r) => r.minutes)).toEqual(expected);
  });
});
