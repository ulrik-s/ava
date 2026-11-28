/**
 * "Fel på fakturan?" (#2260) — regeln för hur en felaktig faktura görs om.
 * Ett obokfört utkast makuleras, en utställd eller bokförd faktura krediteras
 * och görs om; annars ingen väg, med skälet.
 */

import { describe, expect, it } from "vitest-compat";
import {
  ISSUED_CANCEL_REASON, PAID_REDO_REASON, WRITTEN_OFF_REDO_REASON, redoFactsOf, redoOption, type RedoFacts,
} from "@/lib/shared/billing/invoice-redo";
import { asId } from "@/lib/shared/schemas/ids";
import { releasePatch } from "@/lib/shared/time-entry-lock";

const base: RedoFacts = {
  status: "DRAFT", invoiceType: "FINAL", purpose: null, hasSettlementBreakdown: false,
  ledgerRef: null, hasCreditNote: false, paidOre: 0, writtenOffOre: 0, liveDeductingFinals: [],
};

describe("redoOption", () => {
  it("ett obokfört utkast makuleras", () => {
    expect(redoOption(base)).toEqual({ kind: "void" });
  });

  it("ett bokfört utkast krediteras", () => {
    expect(redoOption({ ...base, ledgerRef: "A/1" })).toEqual({ kind: "credit" });
  });

  it("skickad och avbetalningsplan krediteras och görs om", () => {
    for (const status of ["SENT", "INSTALLMENT_PLAN"] as const) expect(redoOption({ ...base, status })).toEqual({ kind: "credit" });
  });

  const blocked: ReadonlyArray<[string, Partial<RedoFacts>, string | RegExp]> = [
    ["kreditfaktura", { invoiceType: "CREDIT", status: "SENT" }, /kreditfaktura kan inte göras om/],
    ["annullerad", { status: "CANCELLED" }, /redan annullerad eller krediterad/],
    ["redan krediterad", { status: "SENT", hasCreditNote: true }, /redan annullerad eller krediterad/],
    ["rådgivningstimmen", { purpose: "RADGIVNING" }, /Rådgivningstimmens faktura/],
    ["slutreglering", { status: "SENT", hasSettlementBreakdown: true }, /Slutregleringens fakturor/],
    ["aconto på en levande slutfaktura", { invoiceType: "ACCONTO", status: "SENT", liveDeductingFinals: ["F-2026-0009"] }, /slutfaktura F-2026-0009/],
    ["betald", { status: "PAID", paidOre: 100 }, PAID_REDO_REASON],
    ["delbetald", { status: "SENT", paidOre: 1 }, PAID_REDO_REASON],
    ["kundförlust", { status: "BAD_DEBT", writtenOffOre: 100 }, WRITTEN_OFF_REDO_REASON],
    ["delvis avskriven", { status: "SENT", writtenOffOre: 1 }, WRITTEN_OFF_REDO_REASON],
  ];
  for (const [name, facts, reason] of blocked) {
    it(`${name}: ingen väg, med skälet`, () => {
      const option = redoOption({ ...base, ...facts });
      expect(option.kind).toBe("blocked");
      if (option.kind === "blocked") expect(option.reason).toMatch(reason);
    });
  }

  it("en ACCONTO med settlementBreakdown (acontots nedbrytning) är ingen slutreglering", () => {
    expect(redoOption({ ...base, invoiceType: "ACCONTO", hasSettlementBreakdown: true })).toEqual({ kind: "void" });
  });

  it("skälet för en skickad faktura nämner kreditnotan och lagrummet", () => {
    expect(ISSUED_CANCEL_REASON).toMatch(/kreditnota.*17 kap\. 22–23 §§/);
  });
});

describe("redoFactsOf", () => {
  it("läser fakturan: kreditnota, slutreglering och levande avdragande slutfakturor", () => {
    const facts = redoFactsOf({
      status: "SENT", invoiceType: "ACCONTO", purpose: undefined, settlementBreakdown: { x: 1 }, creditNote: null,
      deductedOnFinals: [
        { finalInvoice: { status: "CANCELLED", invoiceNumber: "F-1" } },
        { finalInvoice: { status: "DRAFT", invoiceNumber: "F-2" } },
        { finalInvoice: { status: "SENT", invoiceNumber: null } },
        { finalInvoice: null },
      ],
    }, { ledgerRef: "A/1", paidOre: 5, writtenOffOre: 6 });
    expect(facts).toEqual({
      status: "SENT", invoiceType: "ACCONTO", purpose: undefined, hasSettlementBreakdown: true, hasCreditNote: false,
      liveDeductingFinals: ["F-2", "(utan nummer)"], ledgerRef: "A/1", paidOre: 5, writtenOffOre: 6,
    });
  });

  it("utan relationer: inga avdragande slutfakturor och ingen kreditnota", () => {
    const facts = redoFactsOf({ status: "DRAFT", invoiceType: "FINAL" }, { ledgerRef: null, paidOre: 0, writtenOffOre: 0 });
    expect(facts).toMatchObject({ hasCreditNote: false, hasSettlementBreakdown: false, liveDeductingFinals: [] });
  });
});

describe("releasePatch (#2260)", () => {
  const run = asId<"BillingRunId">("run-1");
  const other = asId<"BillingRunId">("run-kr");
  const r = { invoiceId: "inv-1", billingRunIds: [run] };

  it("egen faktura och släppt körning → allt nollas", () => {
    expect(releasePatch({ invoiceId: "inv-1", frozenAt: "2026-11-28", frozenByBillingRunId: run }, r))
      .toEqual({ invoiceId: null, frozenAt: null, frozenByBillingRunId: null });
  });

  it("fryst av körningen utan faktura (ej debiterbar) → frysningen nollas", () => {
    expect(releasePatch({ invoiceId: null, frozenAt: "2026-11-28", frozenByBillingRunId: run }, r))
      .toEqual({ frozenAt: null, frozenByBillingRunId: null });
  });

  it("fryst av en kostnadsräkning → bara kopplingen till fakturan nollas", () => {
    expect(releasePatch({ invoiceId: "inv-1", frozenAt: "2026-11-28", frozenByBillingRunId: other }, r)).toEqual({ invoiceId: null });
  });

  it("en annan fakturas post berörs inte, inte heller en olåst", () => {
    expect(releasePatch({ invoiceId: "inv-2", frozenAt: "2026-11-28", frozenByBillingRunId: run }, r)).toEqual({});
    expect(releasePatch({}, r)).toEqual({});
  });
});
