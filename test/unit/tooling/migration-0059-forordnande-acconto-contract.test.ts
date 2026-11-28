/**
 * Migration 0059 (#2192, contract efter #2180) mot en in-process Postgres
 * (PGlite): varje uppgift får en källa.
 *
 * - Acontofakturor med settlement_breakdown får den flyttad till
 *   acconto_breakdown (om den saknas där), och settlement_breakdown nollas.
 *   Slut- och kreditfakturor lämnas.
 * - Kostnadsräkningar utan forordnande_avslut får det ur anteckningen, med
 *   samma mönster som 0054.
 * - Ändrade rader får ny version och en change_log-rad (inte raderade), och
 *   migreringen går att köra igen utan nya ändringar.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { declaredKind, destructiveStatements } from "../../../tooling/scripts/lib/migration-kind";

const DIR = "tooling/db/migrations";
const TARGET = "0059_forordnande_acconto_contract.sql";

const ORG = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ACCONTO_BOTH = id(1);
const ACCONTO_OLD_ONLY = id(2);
const ACCONTO_NEW_ONLY = id(3);
const FINAL = id(4);
const CREDIT = id(5);
const ACCONTO_DELETED = id(6);
const KR_HISTORIC = id(11);
const KR_TYPED = id(12);
const KR_PLAIN = id(13);
const KR_DELETED = id(14);

const view = (label: string): object => ({ timeLines: [], rows: [{ label, amountOre: 50_000, kind: "add" }], totalLabel: "Att betala", totalOre: 62_500 });
const OLD = view("Gammal");
const NEW = view("Ny");
const NOTE = "Egen anteckning\nFörordnandetaxa – förundersökningen lades ned";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");
const lit = (v: object | string | null): string => {
  if (v === null) return "NULL";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
};

function invoiceRow(rowId: string, type: string, settlement: object | null, acconto: object | null): string {
  return `('${rowId}', '${MATTER}', 62500, now(), '${type}', ${lit(settlement)}, ${lit(acconto)})`;
}

function runRow(rowId: string, notes: string | null, avslut: string | null): string {
  return `('${rowId}', '${MATTER}', 'KOSTNADSRAKNING', 'DOMSTOL', 1000, 1000, 1000, ${lit(notes)}, ${lit(avslut)})`;
}

describe("migration 0059 — contract: acontots nedbrytning och förordnandets avslut får en källa", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    for (const f of files.filter((f) => f < TARGET)) await pg.exec(sqlOf(f));
    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Byrå');
      INSERT INTO matters (id, organization_id, matter_number, title) VALUES ('${MATTER}', '${ORG}', '2026-1', 'Ärende');
      INSERT INTO invoices (id, matter_id, amount, invoice_date, invoice_type, settlement_breakdown, acconto_breakdown) VALUES
        ${[invoiceRow(ACCONTO_BOTH, "ACCONTO", OLD, NEW), invoiceRow(ACCONTO_OLD_ONLY, "ACCONTO", OLD, null),
          invoiceRow(ACCONTO_NEW_ONLY, "ACCONTO", null, NEW), invoiceRow(FINAL, "FINAL", OLD, null),
          invoiceRow(CREDIT, "CREDIT", OLD, null), invoiceRow(ACCONTO_DELETED, "ACCONTO", OLD, null)].join(",\n")};
      UPDATE invoices SET deleted_at = now() WHERE id = '${ACCONTO_DELETED}';
      INSERT INTO billing_runs (id, matter_id, type, recipient, work_value_ore_at_run, proposed_amount_ore, amount_ore, notes, forordnande_avslut) VALUES
        ${[runRow(KR_HISTORIC, NOTE, null), runRow(KR_TYPED, NOTE, "INGET_ATAL"),
          runRow(KR_PLAIN, "Bara en anteckning", null), runRow(KR_DELETED, NOTE, null)].join(",\n")};
      UPDATE billing_runs SET deleted_at = now() WHERE id = '${KR_DELETED}';
    `);
    await pg.exec(sqlOf(TARGET));
  });
  afterAll(async () => { await pg.close(); });

  const invoice = async (rowId: string) => (await pg.query<{ settlement_breakdown: unknown; acconto_breakdown: unknown; version: number }>(
    `SELECT settlement_breakdown, acconto_breakdown, version FROM invoices WHERE id = '${rowId}'`)).rows[0];
  const runOf = async (rowId: string) => (await pg.query<{ forordnande_avslut: string | null; version: number; notes: string }>(
    `SELECT forordnande_avslut, version, notes FROM billing_runs WHERE id = '${rowId}'`)).rows[0];
  const changeLog = async () => (await pg.query<{ entity: string; row_id: string; version: number }>(
    `SELECT entity, row_id, version FROM change_log ORDER BY entity, row_id`)).rows;

  it("är en contract utan destruktiv SQL", () => {
    expect(declaredKind(sqlOf(TARGET))).toBe("contract");
    expect(destructiveStatements(sqlOf(TARGET))).toEqual([]);
  });

  it("ett aconto med båda kolumnerna behåller acconto_breakdown och nollar bara settlement_breakdown", async () => {
    expect(await invoice(ACCONTO_BOTH)).toEqual({ settlement_breakdown: null, acconto_breakdown: NEW, version: 2 });
  });

  it("ett aconto med bara settlement_breakdown får den flyttad", async () => {
    expect(await invoice(ACCONTO_OLD_ONLY)).toEqual({ settlement_breakdown: null, acconto_breakdown: OLD, version: 2 });
    expect(await invoice(ACCONTO_DELETED)).toMatchObject({ settlement_breakdown: null, acconto_breakdown: OLD });
  });

  it("slut- och kreditfakturor och ett aconto utan gammal kolumn lämnas", async () => {
    expect(await invoice(FINAL)).toEqual({ settlement_breakdown: OLD, acconto_breakdown: null, version: 1 });
    expect(await invoice(CREDIT)).toEqual({ settlement_breakdown: OLD, acconto_breakdown: null, version: 1 });
    expect(await invoice(ACCONTO_NEW_ONLY)).toEqual({ settlement_breakdown: null, acconto_breakdown: NEW, version: 1 });
  });

  it("en kostnadsräkning med bara raden i anteckningen får avslutet; anteckningen står kvar", async () => {
    expect(await runOf(KR_HISTORIC)).toEqual({ forordnande_avslut: "NEDLAGD", version: 2, notes: NOTE });
  });

  it("ett redan satt avslut och en vanlig anteckning lämnas", async () => {
    expect(await runOf(KR_TYPED)).toMatchObject({ forordnande_avslut: "INGET_ATAL", version: 1 });
    expect(await runOf(KR_PLAIN)).toMatchObject({ forordnande_avslut: null, version: 1 });
  });

  it("klienterna får veta: change_log för ändrade levande rader, inte raderade", async () => {
    expect((await runOf(KR_DELETED))?.forordnande_avslut).toBe("NEDLAGD");
    expect(await changeLog()).toEqual([
      { entity: "billingRun", row_id: KR_HISTORIC, version: 2 },
      { entity: "invoice", row_id: ACCONTO_BOTH, version: 2 },
      { entity: "invoice", row_id: ACCONTO_OLD_ONLY, version: 2 },
    ]);
  });

  it("migreringen går att köra igen utan nya ändringar", async () => {
    await pg.exec(sqlOf(TARGET));
    expect(await changeLog()).toHaveLength(3);
    expect((await invoice(ACCONTO_OLD_ONLY))?.version).toBe(2);
  });
});
