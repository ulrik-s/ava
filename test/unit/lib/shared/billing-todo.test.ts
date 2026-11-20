/**
 * Faktureringens "måste göras"-predikat (#1221) — delas av panelen och
 * Att bevaka-signalen `billingAction`.
 */
import { describe, expect, it } from "vitest-compat";
import {
  hasSjalvriskAconto, insurerPruningPending, isActiveKr, krCanCreateInvoice, sjalvriskAccontoDue, type TodoRun,
} from "@/lib/shared/billing-todo";

const kr = (kostnadsrakningStatus: TodoRun["kostnadsrakningStatus"], extra: Partial<TodoRun> = {}): TodoRun => ({
  type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", recipient: "DOMSTOL", kostnadsrakningStatus, ...extra,
});

describe("isActiveKr", () => {
  it("inskickad, överklagad och beslutad KR är aktiv", () => {
    expect(isActiveKr(kr("INSKICKAD"))).toBe(true);
    expect(isActiveKr(kr("OVERKLAGAD"))).toBe(true);
    expect(isActiveKr(kr("BESLUTAD"))).toBe(true);
  });

  it("ångrad, fakturerad eller statuslös KR är inte aktiv", () => {
    expect(isActiveKr(kr("INSKICKAD", { status: "VOIDED" }))).toBe(false);
    expect(isActiveKr(kr("FAKTURERAD"))).toBe(false);
    expect(isActiveKr(kr(null))).toBe(false);
  });
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

describe("självrisk-aconto", () => {
  const aconto: TodoRun = { type: "ACCONTO", status: "SENT", recipient: "KLIENT" };

  it("rättshjälp, över tröskeln, inget aconto → dags", () => {
    expect(sjalvriskAccontoDue({ method: "RATTSHJALP", clientOre: 150_000, thresholdOre: 150_000, runs: [] })).toBe(true);
  });

  it("under tröskeln, redan aconto eller annat betalningssätt → inte", () => {
    expect(sjalvriskAccontoDue({ method: "RATTSHJALP", clientOre: 149_999, thresholdOre: 150_000, runs: [] })).toBe(false);
    expect(hasSjalvriskAconto([aconto])).toBe(true);
    expect(sjalvriskAccontoDue({ method: "RATTSHJALP", clientOre: 999_999, thresholdOre: 150_000, runs: [aconto] })).toBe(false);
    expect(sjalvriskAccontoDue({ method: "PRIVAT", clientOre: 999_999, thresholdOre: 150_000, runs: [] })).toBe(false);
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
