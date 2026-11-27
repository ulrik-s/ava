/**
 * Migration 0053 (#1901) mot en in-process Postgres (PGlite): loggen över
 * skickade mejl nycklas på (organization_id, idempotency_key), samma nyckel får
 * finnas i två byråer men bara en gång per byrå, och migrationen går att köra
 * igen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { declaredKind } from "../../../tooling/scripts/lib/migration-kind";

const DIR = "tooling/db/migrations";
const TARGET = "0053_email_dispatch_log.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

const sent = (org: string): string =>
  `INSERT INTO email_dispatch_log (organization_id, idempotency_key) VALUES ('${org}', 'payment.due:p1:2026-11')`;

async function primaryKeyColumns(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ attname: string }>(`
    SELECT a.attname FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = 'email_dispatch_log'::regclass AND c.contype = 'p' ORDER BY k.ord`);
  return rows.map((r) => r.attname);
}

describe("migration 0053 — loggen över skickade mejl", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f <= TARGET)) await pg.exec(sqlOf(f));
  });
  afterAll(async () => { await pg.close(); });

  it("är märkt som expand", () => {
    expect(declaredKind(sqlOf(TARGET))).toBe("expand");
  });

  it("nyckeln är (organization_id, idempotency_key)", async () => {
    expect(await primaryKeyColumns(pg)).toEqual(["organization_id", "idempotency_key"]);
  });

  it("sent_at får tiden, och samma nyckel får finnas i en annan byrå men inte två gånger i samma", async () => {
    await pg.exec(sent(ORG));
    await pg.exec(sent(OTHER));
    await expect(pg.exec(sent(ORG))).rejects.toThrow(/email_dispatch_log_pk/);
    const { rows } = await pg.query<{ sent_at: Date | null }>(`SELECT sent_at FROM email_dispatch_log WHERE organization_id = '${ORG}'`);
    expect(rows[0]?.sent_at).not.toBeNull();
  });

  it("migrationen går att köra två gånger", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await primaryKeyColumns(pg)).toEqual(["organization_id", "idempotency_key"]);
    expect((await pg.query(`SELECT 1 FROM email_dispatch_log`)).rows).toHaveLength(2);
  });
});
