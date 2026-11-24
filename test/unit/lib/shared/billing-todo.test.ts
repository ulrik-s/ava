/**
 * Faktureringens "måste göras"-predikat (#1221) — delas av panelen och
 * Att bevaka-signalen `billingAction`.
 */
import { describe, expect, it } from "vitest-compat";
import { accontoSplit } from "@/lib/shared/acconto-vat";
import { proposedAccontoOre } from "@/lib/shared/billing-proposal";
import {
  insurerPruningPending, krCanCreateInvoice, sjalvriskAccontoDue, unbilledClientShareNetOre, type TodoRun,
} from "@/lib/shared/billing-todo";
import { roundToKronor } from "@/lib/shared/whole-kronor";

const kr = (kostnadsrakningStatus: TodoRun["kostnadsrakningStatus"], extra: Partial<TodoRun> = {}): TodoRun => ({
  type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", recipient: "DOMSTOL", kostnadsrakningStatus, ...extra,
});

describe("krCanCreateInvoice (#1225)", () => {
  it("bara en beslutad KR kan faktureras", () => {
    expect(krCanCreateInvoice(kr("BESLUTAD"))).toBe(true);
    expect(krCanCreateInvoice(kr("BESLUTAD", { beslutSlutgiltigt: true }))).toBe(true);
    expect(krCanCreateInvoice(kr("INSKICKAD"))).toBe(false);
    expect(krCanCreateInvoice(kr("OVERKLAGAD"))).toBe(false);
    expect(krCanCreateInvoice(kr("FAKTURERAD"))).toBe(false);
  });
});

describe("självrisk-aconto (#1852)", () => {
  // 7 500 kr upparbetat × 20 % = 1 500 kr netto = 1 875 kr med moms.
  const base = { method: "RATTSHJALP" as const, workValueOre: 750_000, priorAccontoSumOre: 0, clientShareBips: 2000, thresholdOre: 150_000, accontoAllowed: true };

  it("nettot är dialogens förslag utan moms, avrundat till hela kronor", () => {
    expect(unbilledClientShareNetOre(750_000, 2000, 0)).toBe(150_000);
    expect(unbilledClientShareNetOre(750_000, 2000, 0) + accontoSplit(roundToKronor(proposedAccontoOre(750_000, 2000, 0))).vatOre)
      .toBe(roundToKronor(proposedAccontoOre(750_000, 2000, 0)));
    expect(unbilledClientShareNetOre(750_000, 2000, 187_500)).toBe(0);
  });

  it("rättshjälp och rättsskydd ger påminnelse, privat aldrig", () => {
    expect(sjalvriskAccontoDue(base)).toBe(true);
    expect(sjalvriskAccontoDue({ ...base, method: "RATTSSKYDD" })).toBe(true);
    for (const method of ["PRIVAT", "MIX", "PENDING", "OFFENTLIGT_UPPDRAG", null, undefined] as const) {
      expect(sjalvriskAccontoDue({ ...base, method })).toBe(false);
    }
  });

  it("precis på tröskeln ger påminnelse, precis under inte", () => {
    expect(sjalvriskAccontoDue({ ...base, thresholdOre: 150_000 })).toBe(true);
    expect(sjalvriskAccontoDue({ ...base, thresholdOre: 150_100 })).toBe(false);
  });

  it("efter ett skickat aconto räknas självrisken från noll igen", () => {
    expect(sjalvriskAccontoDue({ ...base, priorAccontoSumOre: 187_500 })).toBe(false);
    expect(sjalvriskAccontoDue({ ...base, workValueOre: 1_500_000, priorAccontoSumOre: 187_500 })).toBe(true);
  });

  it("aconto som inte är tillåtet i fasen ger ingen påminnelse", () => {
    expect(sjalvriskAccontoDue({ ...base, accontoAllowed: false })).toBe(false);
  });
});

describe("insurerPruningPending", () => {
  const payer: TodoRun = { type: "FINAL", status: "SENT", recipient: "FORSAKRING" };

  it("rättsskydd med obetald försäkringsfaktura och ingen prutning → väntar", () => {
    expect(insurerPruningPending("RATTSSKYDD", [payer])).toBe(true);
    expect(insurerPruningPending("RATTSSKYDD", [{ ...payer, invoice: { status: "SENT" } }])).toBe(true);
  });

  it("registrerad prutning, betald faktura, ingen försäkringsfaktura eller annat betalningssätt → inte", () => {
    expect(insurerPruningPending("RATTSSKYDD", [{ ...payer, prutningOre: -100 }])).toBe(false);
    expect(insurerPruningPending("RATTSSKYDD", [{ ...payer, invoice: { status: "PAID" } }])).toBe(false);
    expect(insurerPruningPending("RATTSSKYDD", [])).toBe(false);
    expect(insurerPruningPending("PRIVAT", [payer])).toBe(false);
  });
});
