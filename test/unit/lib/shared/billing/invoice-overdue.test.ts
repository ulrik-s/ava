/**
 * Den delade förfallen-regeln (#1731) — fakturalistan och "Att bevaka" läser samma.
 */

import { describe, expect, it } from "vitest-compat";
import { invoiceAttention, needsAttention, outstandingOre, overdueDays, type OverdueCandidate } from "@/lib/shared/billing/invoice-overdue";

/** Tisdag 10 mars 2026, mitt på dagen svensk tid. */
const NOW = new Date("2026-03-10T12:00:00+01:00");

const inv = (over: Partial<OverdueCandidate> = {}): OverdueCandidate => ({
  status: "SENT", dueDate: "2026-03-09", amount: 10_000, payments: [], ...over,
});

describe("outstandingOre", () => {
  it("belopp minus betalningar", () => {
    expect(outstandingOre(inv({ payments: [{ amount: 3_000 }, { amount: 2_000 }] }))).toBe(5_000);
  });

  it("utan betalningslista: hela beloppet", () => {
    expect(outstandingOre(inv({ payments: null }))).toBe(10_000);
    expect(outstandingOre({ status: "SENT", amount: 7 })).toBe(7);
  });
});

describe("overdueDays", () => {
  it("Skickad, förfallodag i går, obetalt kvar → förfallen 1 dag", () => {
    expect(overdueDays(inv(), NOW)).toBe(1);
  });

  it("räknar hela dagar efter förfallodagen", () => {
    expect(overdueDays(inv({ dueDate: "2026-02-26" }), NOW)).toBe(12);
  });

  it("Avbetalningsplan räknas", () => {
    expect(overdueDays(inv({ status: "INSTALLMENT_PLAN" }), NOW)).toBe(1);
  });

  it("helt betald → inte förfallen", () => {
    expect(overdueDays(inv({ payments: [{ amount: 10_000 }] }), NOW)).toBeNull();
  });

  it("status Betald eller Skapad → inte förfallen", () => {
    expect(overdueDays(inv({ status: "PAID" }), NOW)).toBeNull();
    expect(overdueDays(inv({ status: "DRAFT" }), NOW)).toBeNull();
  });

  it("förfallodag i dag → inte förfallen", () => {
    expect(overdueDays(inv({ dueDate: "2026-03-10" }), NOW)).toBeNull();
  });

  it("saknad förfallodag → inte förfallen", () => {
    expect(overdueDays(inv({ dueDate: null }), NOW)).toBeNull();
    expect(overdueDays(inv({ dueDate: undefined }), NOW)).toBeNull();
  });

  it("dagen räknas i svensk tid runt midnatt", () => {
    // 00:30 svensk tid den 10/3 = 23:30 UTC den 9/3: i Sverige är det redan dagen efter.
    const justAfterMidnight = new Date("2026-03-10T00:30:00+01:00");
    expect(overdueDays(inv(), justAfterMidnight)).toBe(1);
    // 23:30 svensk tid den 9/3: förfallodagen är fortfarande i dag.
    const justBeforeMidnight = new Date("2026-03-09T23:30:00+01:00");
    expect(overdueDays(inv(), justBeforeMidnight)).toBeNull();
  });

  it("förfallodag som tidpunkt (Date) på svensk midnatt → rätt svensk dag", () => {
    expect(overdueDays(inv({ dueDate: new Date("2026-03-09T00:00:00+01:00") }), NOW)).toBe(1);
  });
});

describe("invoiceAttention / needsAttention", () => {
  it("förfallen och misslyckat utskick på samma faktura", () => {
    const a = invoiceAttention({ ...inv(), id: "i1" }, new Set(["i1"]), NOW);
    expect(a).toEqual({ overdueDays: 1, failedDispatch: true });
    expect(needsAttention(a)).toBe(true);
  });

  it("bara misslyckat utskick", () => {
    const a = invoiceAttention({ ...inv({ status: "PAID" }), id: "i1" }, new Set(["i1"]), NOW);
    expect(a).toEqual({ overdueDays: null, failedDispatch: true });
    expect(needsAttention(a)).toBe(true);
  });

  it("varken eller → ingen markering", () => {
    const a = invoiceAttention({ ...inv({ status: "PAID" }), id: "i1" }, new Set(["i2"]), NOW);
    expect(needsAttention(a)).toBe(false);
  });
});
