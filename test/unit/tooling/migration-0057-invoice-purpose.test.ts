/**
 * Migration 0057 (#1933) mot en in-process Postgres (PGlite): fakturans
 * affärsroll `invoices.purpose`.
 *
 * - Fakturor med rådgivningstexten (STANDARD och ACCONTO) får `RADGIVNING`, ny
 *   version och en change_log-rad med ärendets org-id. Texten byggs med
 *   `RADGIVNING_INVOICE_NOTES`, så SQL-texten och konstanten kan inte glida isär.
 * - En kreditnota med texten och en faktura med en annan text lämnas.
 * - En raderad faktura får markören men ingen change_log-rad.
 * - Migreringen går att köra igen utan nya ändringar.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { invoices } from "@/lib/server/db/schema";
import { RADGIVNING_INVOICE_NOTES } from "@/lib/shared/billing/radgivning-entry";
import { declaredKind, destructiveStatements } from "../../../tooling/scripts/lib/migration-kind";

const DIR = "tooling/db/migrations";
const TARGET = "0057_invoice_purpose.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const STANDARD = id(1);
const ACCONTO = id(2);
const CREDIT = id(3);
const OTHER_TEXT = id(4);
const DELETED = id(5);

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;

function invoiceRow(rowId: string, type: string, notes: string): string {
  return `('${rowId}', '${MATTER}', 125000, now(), '${type}', ${lit(notes)})`;
}

describe("migration 0057 — fakturans affärsroll (purpose)", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${MATTER}', '${ORG}', '2026-1', 'Ärende');
      INSERT INTO invoices (id, matter_id, amount, invoice_date, invoice_type, notes) VALUES
        ${[invoiceRow(STANDARD, "STANDARD", RADGIVNING_INVOICE_NOTES),
          invoiceRow(ACCONTO, "ACCONTO", RADGIVNING_INVOICE_NOTES),
          invoiceRow(CREDIT, "CREDIT", RADGIVNING_INVOICE_NOTES),
          invoiceRow(OTHER_TEXT, "STANDARD", "Arvode enligt överenskommelse"),
          invoiceRow(DELETED, "STANDARD", RADGIVNING_INVOICE_NOTES)].join(",\n")};
      UPDATE invoices SET deleted_at = now() WHERE id = '${DELETED}';
    `);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  const invoice = async (rowId: string) => (await pg.query<{ purpose: string | null; version: number; notes: string; amount: number }>(
    `SELECT purpose, version, notes, amount FROM invoices WHERE id = '${rowId}'`)).rows[0];
  const changeLog = async () => (await pg.query<{ organization_id: string; entity: string; row_id: string; version: number; op: string }>(
    `SELECT organization_id, entity, row_id, version, op FROM change_log ORDER BY row_id`)).rows;

  it("är en expand utan destruktiv SQL", () => {
    expect(declaredKind(sqlOf(TARGET))).toBe("expand");
    expect(destructiveStatements(sqlOf(TARGET))).toEqual([]);
  });

  it("rådgivningsfakturor (STANDARD och ACCONTO) får RADGIVNING och ny version; text och belopp står kvar", async () => {
    const same = { purpose: "RADGIVNING", version: 2, notes: RADGIVNING_INVOICE_NOTES, amount: 125000 };
    expect(await invoice(STANDARD)).toEqual(same);
    expect(await invoice(ACCONTO)).toEqual(same);
    expect((await invoice(DELETED))?.purpose).toBe("RADGIVNING");
  });

  it("en kreditnota med texten och en faktura med en annan text lämnas", async () => {
    expect(await invoice(CREDIT)).toMatchObject({ purpose: null, version: 1 });
    expect(await invoice(OTHER_TEXT)).toMatchObject({ purpose: null, version: 1 });
  });

  it("klienterna får veta: change_log med ärendets org-id för levande rader, inte raderade", async () => {
    const row = (rowId: string) => ({ organization_id: ORG, entity: "invoice", row_id: rowId, version: 2, op: "update" });
    expect(await changeLog()).toEqual([row(STANDARD), row(ACCONTO)]);
  });

  it("migreringen går att köra igen utan nya ändringar", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await changeLog()).toHaveLength(2);
    expect((await invoice(STANDARD))?.version).toBe(2);
  });

  it("Drizzle-schemat har kolumnen", () => {
    expect(getTableColumns(invoices).purpose.name).toBe("purpose");
  });
});
