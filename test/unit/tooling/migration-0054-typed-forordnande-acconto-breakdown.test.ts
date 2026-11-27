/**
 * Migration 0054 (#2180) mot en in-process Postgres (PGlite): förordnandemålets
 * avslut och acontofakturans nedbrytning får egna kolumner.
 *
 * - Acontofakturor (invoice_type = 'ACCONTO') med en nedbrytning får den
 *   kopierad till acconto_breakdown. Slutfakturor och acontofakturor utan
 *   nedbrytning lämnas.
 * - Kostnadsräkningar vars anteckning slutar med förordnandetaxans rad får
 *   avslutet ur den. Raden skrivs av `krRunNotes`, så testet bygger
 *   anteckningarna med den: en ändrad etikett fäller testet.
 * - Ändrade rader får ny version och en change_log-rad (inte raderade), och
 *   migreringen går att köra igen utan nya ändringar.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { krRunNotes } from "@/lib/server/billing/kr-run-valuation";
import { billingRuns, invoices } from "@/lib/server/db/schema";
import { declaredKind, destructiveStatements } from "../../../tooling/scripts/lib/migration-kind";

const DIR = "tooling/db/migrations";
const TARGET = "0054_typed_forordnande_acconto_breakdown.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ACCONTO = id(1);
const ACCONTO_EMPTY = id(2);
const FINAL = id(3);
const ACCONTO_DELETED = id(4);
const KR_NEDLAGD = id(11);
const KR_STRAFF = id(12);
const KR_INGET = id(13);
const KR_PLAIN = id(14);
const ACCONTO_RUN_WITH_TEXT = id(15);

const BREAKDOWN = { timeLines: [], rows: [{ label: "Aconto", amountOre: 50_000, kind: "add" }], totalLabel: "Att betala", totalOre: 62_500 };

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");
const lit = (v: string | null): string => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

const noteOf = (avslut: "NEDLAGD" | "STRAFFORELAGGANDE" | "INGET_ATAL", own: string | null = null): string =>
  krRunNotes(own, { forordnande: { avslut } }) ?? "";

function invoiceRow(rowId: string, type: string, breakdown: object | null): string {
  return `('${rowId}', '${MATTER}', 62500, now(), '${type}', ${breakdown ? lit(JSON.stringify(breakdown)) : "NULL"})`;
}

function runRow(rowId: string, type: string, notes: string | null): string {
  return `('${rowId}', '${MATTER}', '${type}', 'DOMSTOL', 1000, 1000, 1000, ${lit(notes)})`;
}

describe("migration 0054 — typade kolumner för förordnandemålets avslut och acontots nedbrytning", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${MATTER}', '${ORG}', '2026-1', 'Ärende');
      INSERT INTO invoices (id, matter_id, amount, invoice_date, invoice_type, settlement_breakdown) VALUES
        ${[invoiceRow(ACCONTO, "ACCONTO", BREAKDOWN), invoiceRow(ACCONTO_EMPTY, "ACCONTO", null),
          invoiceRow(FINAL, "FINAL", BREAKDOWN), invoiceRow(ACCONTO_DELETED, "ACCONTO", BREAKDOWN)].join(",\n")};
      UPDATE invoices SET deleted_at = now() WHERE id = '${ACCONTO_DELETED}';
      INSERT INTO billing_runs (id, matter_id, type, recipient, work_value_ore_at_run, proposed_amount_ore, amount_ore, notes) VALUES
        ${[runRow(KR_NEDLAGD, "KOSTNADSRAKNING", noteOf("NEDLAGD")),
          runRow(KR_STRAFF, "KOSTNADSRAKNING", noteOf("STRAFFORELAGGANDE", "Egen anteckning")),
          runRow(KR_INGET, "KOSTNADSRAKNING", noteOf("INGET_ATAL")),
          runRow(KR_PLAIN, "KOSTNADSRAKNING", "Förordnandetaxa – förundersökningen lades ned, enligt klienten"),
          runRow(ACCONTO_RUN_WITH_TEXT, "ACCONTO", noteOf("NEDLAGD"))].join(",\n")};
    `);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  const invoice = async (rowId: string) => (await pg.query<{ acconto_breakdown: unknown; version: number }>(
    `SELECT acconto_breakdown, version FROM invoices WHERE id = '${rowId}'`)).rows[0];
  const runOf = async (rowId: string) => (await pg.query<{ forordnande_avslut: string | null; version: number; notes: string }>(
    `SELECT forordnande_avslut, version, notes FROM billing_runs WHERE id = '${rowId}'`)).rows[0];
  const changeLog = async () => (await pg.query<{ entity: string; row_id: string; version: number }>(
    `SELECT entity, row_id, version FROM change_log ORDER BY entity, row_id`)).rows;

  it("är en expand utan destruktiv SQL", () => {
    expect(declaredKind(sqlOf(TARGET))).toBe("expand");
    expect(destructiveStatements(sqlOf(TARGET))).toEqual([]);
  });

  it("acontofakturans nedbrytning kopieras till acconto_breakdown, med ny version", async () => {
    expect(await invoice(ACCONTO)).toEqual({ acconto_breakdown: BREAKDOWN, version: 2 });
    expect((await invoice(ACCONTO_DELETED))?.acconto_breakdown).toEqual(BREAKDOWN);
  });

  it("slutfakturan och acontot utan nedbrytning lämnas", async () => {
    expect(await invoice(FINAL)).toEqual({ acconto_breakdown: null, version: 1 });
    expect(await invoice(ACCONTO_EMPTY)).toEqual({ acconto_breakdown: null, version: 1 });
  });

  it("kostnadsräkningens avslut läses ur anteckningen, som står kvar", async () => {
    expect(await runOf(KR_NEDLAGD)).toMatchObject({ forordnande_avslut: "NEDLAGD", version: 2 });
    expect(await runOf(KR_STRAFF)).toMatchObject({ forordnande_avslut: "STRAFFORELAGGANDE", version: 2, notes: noteOf("STRAFFORELAGGANDE", "Egen anteckning") });
    expect(await runOf(KR_INGET)).toMatchObject({ forordnande_avslut: "INGET_ATAL", version: 2 });
  });

  it("en anteckning som inte slutar med raden, eller en annan körningstyp, lämnas", async () => {
    expect(await runOf(KR_PLAIN)).toMatchObject({ forordnande_avslut: null, version: 1 });
    expect(await runOf(ACCONTO_RUN_WITH_TEXT)).toMatchObject({ forordnande_avslut: null, version: 1 });
  });

  it("klienterna får veta: change_log för ändrade levande rader, inte raderade", async () => {
    expect(await changeLog()).toEqual([
      { entity: "billingRun", row_id: KR_NEDLAGD, version: 2 },
      { entity: "billingRun", row_id: KR_STRAFF, version: 2 },
      { entity: "billingRun", row_id: KR_INGET, version: 2 },
      { entity: "invoice", row_id: ACCONTO, version: 2 },
    ]);
  });

  it("migreringen går att köra igen utan nya ändringar", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await changeLog()).toHaveLength(4);
    expect((await invoice(ACCONTO))?.version).toBe(2);
  });

  it("Drizzle-schemat har kolumnerna", () => {
    expect(getTableColumns(invoices).accontoBreakdown.name).toBe("acconto_breakdown");
    expect(getTableColumns(billingRuns).forordnandeAvslut.name).toBe("forordnande_avslut");
  });
});
