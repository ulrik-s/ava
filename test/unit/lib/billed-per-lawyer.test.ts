/**
 * Lås beräkningen för "Fakturerat per advokat" (#90): proportionell
 * attribution, period-filter, och avskrivnings-avdrag mot föregående period.
 */

import { describe, it, expect } from "vitest-compat";
import { billedPerLawyer, type BilledPerLawyerOpts, type BilledInvoiceInput } from "@/lib/shared/billed-per-lawyer";

const PERIOD = { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-30T23:59:59Z") };
const PREV = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-05-31T23:59:59Z") };

function run(over: Partial<BilledPerLawyerOpts>): ReturnType<typeof billedPerLawyer> {
  return billedPerLawyer({
    userId: "anna",
    invoices: [],
    frozenWork: [],
    period: PERIOD,
    prevPeriod: PREV,
    ...over,
  });
}

const inv = (o: Partial<BilledInvoiceInput> = {}) => ({
  id: "i1", amountOre: 100_000, invoiceDate: new Date("2026-06-15T00:00:00Z"),
  status: "SENT", writtenOffAt: null, ...o,
});

describe("billedPerLawyer", () => {
  it("attribuerar hela fakturan när bara en advokat har frozen tid", () => {
    const r = run({
      invoices: [inv()],
      frozenWork: [{ invoiceId: "i1", userId: "anna", workOre: 80_000 }],
    });
    expect(r.billedOre).toBe(100_000);
    expect(r.invoices).toHaveLength(1);
    expect(r.invoices[0]!.shareOre).toBe(100_000);
  });

  it("fördelar proportionellt mot arbetsvärde vid flera advokater", () => {
    const r = run({
      invoices: [inv({ amountOre: 100_000 })],
      // Anna 75%, Björn 25% av arbetsvärdet.
      frozenWork: [
        { invoiceId: "i1", userId: "anna", workOre: 75_000 },
        { invoiceId: "i1", userId: "bjorn", workOre: 25_000 },
      ],
    });
    expect(r.billedOre).toBe(75_000); // Annas andel
  });

  it("0 för advokat utan frozen tid i fakturan", () => {
    const r = run({
      invoices: [inv()],
      frozenWork: [{ invoiceId: "i1", userId: "bjorn", workOre: 80_000 }],
    });
    expect(r.billedOre).toBe(0);
    expect(r.invoices).toHaveLength(0);
  });

  it("ignorerar fakturor utan frozen tid (ej attribuerbara)", () => {
    const r = run({ invoices: [inv()], frozenWork: [] });
    expect(r.billedOre).toBe(0);
    expect(r.invoices).toHaveLength(0);
  });

  it("räknar bara utfärdade statusar — DRAFT/CANCELLED exkluderas", () => {
    const r = run({
      invoices: [
        inv({ id: "draft", status: "DRAFT" }),
        inv({ id: "cancelled", status: "CANCELLED" }),
        inv({ id: "sent", status: "SENT" }),
      ],
      frozenWork: [
        { invoiceId: "draft", userId: "anna", workOre: 10_000 },
        { invoiceId: "cancelled", userId: "anna", workOre: 10_000 },
        { invoiceId: "sent", userId: "anna", workOre: 10_000 },
      ],
    });
    expect(r.invoices.map((i) => i.id)).toEqual(["sent"]);
    expect(r.billedOre).toBe(100_000);
  });

  it("filtrerar på invoiceDate inom perioden", () => {
    const r = run({
      invoices: [
        inv({ id: "before", invoiceDate: new Date("2026-05-20T00:00:00Z") }),
        inv({ id: "inside", invoiceDate: new Date("2026-06-10T00:00:00Z") }),
        inv({ id: "after", invoiceDate: new Date("2026-07-01T00:00:00Z") }),
      ],
      frozenWork: [
        { invoiceId: "before", userId: "anna", workOre: 1 },
        { invoiceId: "inside", userId: "anna", workOre: 1 },
        { invoiceId: "after", userId: "anna", workOre: 1 },
      ],
    });
    expect(r.invoices.map((i) => i.id)).toEqual(["inside"]);
  });

  it("drar av advokatens andel av fakturor avskrivna i föregående period", () => {
    const r = run({
      invoices: [
        inv({ id: "billed", amountOre: 100_000, invoiceDate: new Date("2026-06-15T00:00:00Z"), status: "SENT" }),
        // Avskriven i maj (föregående period). Utfärdad tidigare, så inte med i denna periods "billed".
        inv({ id: "writeoff", amountOre: 40_000, invoiceDate: new Date("2026-03-01T00:00:00Z"), status: "BAD_DEBT", writtenOffAt: new Date("2026-05-10T00:00:00Z") }),
      ],
      frozenWork: [
        { invoiceId: "billed", userId: "anna", workOre: 10_000 },
        { invoiceId: "writeoff", userId: "anna", workOre: 10_000 },
      ],
    });
    expect(r.billedOre).toBe(100_000);
    expect(r.writeOffOre).toBe(40_000);
    expect(r.netOre).toBe(60_000);
  });

  it("avskrivning utanför föregående period påverkar inte avdraget", () => {
    const r = run({
      invoices: [
        inv({ id: "writeoff-apr", amountOre: 40_000, status: "BAD_DEBT", invoiceDate: new Date("2026-02-01T00:00:00Z"), writtenOffAt: new Date("2026-04-10T00:00:00Z") }),
      ],
      frozenWork: [{ invoiceId: "writeoff-apr", userId: "anna", workOre: 10_000 }],
    });
    expect(r.writeOffOre).toBe(0);
    expect(r.netOre).toBe(0);
  });

  it("avskriven faktura fördelar avdraget proportionellt", () => {
    const r = run({
      invoices: [
        inv({ id: "wo", amountOre: 100_000, status: "BAD_DEBT", invoiceDate: new Date("2026-03-01T00:00:00Z"), writtenOffAt: new Date("2026-05-15T00:00:00Z") }),
      ],
      frozenWork: [
        { invoiceId: "wo", userId: "anna", workOre: 30_000 },
        { invoiceId: "wo", userId: "bjorn", workOre: 70_000 },
      ],
    });
    expect(r.writeOffOre).toBe(30_000); // Annas 30%
  });

  it("tomt resultat när inga fakturor", () => {
    const r = run({});
    expect(r).toEqual({ invoices: [], billedOre: 0, writeOffOre: 0, netOre: 0 });
  });
});
