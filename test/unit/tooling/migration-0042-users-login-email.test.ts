/**
 * Migration 0042 (#1408) mot en in-process Postgres (PGlite): e-postadressen
 * är unik över alla byråer (skiftläge och omgivande blanksteg spelar ingen
 * roll, raderade rader räknas inte). Finns redan dubbletter skapas indexet
 * INTE och migreringen fälls inte — adresserna rapporteras som en NOTICE.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "bun:test";

const DIR = "tooling/db/migrations";
const TARGET = "0042_users_login_email_unique.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

let seq = 0;
const user = (org: string, email: string, deletedAt: string | null = null): string => {
  seq += 1;
  const id = `a0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  return `INSERT INTO users (id, organization_id, email, name, deleted_at) VALUES ('${id}', '${org}', '${email}', 'Namn', ${deletedAt ? `'${deletedAt}'` : "NULL"})`;
};

const hasIndex = async (pg: PGlite): Promise<boolean> =>
  (await pg.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_login_email_uq'`)).rows.length === 1;

/** En databas med alla migrationer före 0042, raderna `before`, och sedan 0042. */
async function migrated(before: readonly string[]): Promise<{ pg: PGlite; notices: string[] }> {
  const pg = new PGlite();
  for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
  for (const sql of before) await pg.exec(sql);
  const notices: string[] = [];
  await pg.exec(sqlOf(TARGET), { onNotice: (n) => notices.push(n.message ?? "") });
  return { pg, notices };
}

describe("migration 0042 — e-postadressen är unik över alla byråer", () => {
  let pg: PGlite | null = null;
  afterEach(async () => { await pg?.close(); pg = null; });

  it("utan dubbletter: indexet skapas och en ny dubblett vägras — även i en annan byrå och i annat skiftläge", async () => {
    const m = await migrated([user(ORG, "anna@byra.se"), user(OTHER, "bo@annan.se"), user(ORG, "gammal@byra.se", "2026-01-01T00:00:00Z")]);
    pg = m.pg;
    expect(await hasIndex(pg)).toBe(true);
    expect(m.notices).toEqual([]);
    await expect(pg.exec(user(OTHER, " Anna@Byra.se "))).rejects.toThrow(/users_login_email_uq/);
    // En raderad rad (tombstone) håller inte adressen.
    await pg.exec(user(OTHER, "gammal@byra.se"));
  });

  it("med dubbletter: indexet skapas inte, migreringen fälls inte, och adresserna rapporteras", async () => {
    const m = await migrated([user(ORG, "anna@byra.se"), user(OTHER, "ANNA@byra.se"), user(ORG, "bo@byra.se")]);
    pg = m.pg;
    expect(await hasIndex(pg)).toBe(false);
    expect(m.notices.some((n) => n.includes("users_login_email_uq") && n.includes("anna@byra.se (2 konton)"))).toBe(true);
    expect(m.notices.join(" ")).not.toContain("bo@byra.se");
  });

  it("kan köras igen", async () => {
    const m = await migrated([user(ORG, "anna@byra.se")]);
    pg = m.pg;
    await pg.exec(sqlOf(TARGET));
    expect(await hasIndex(pg)).toBe(true);
  });
});
