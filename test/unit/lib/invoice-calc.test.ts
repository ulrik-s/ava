import { describe, it, expect } from "vitest";
import {
  computeFinalInvoiceBreakdown,
  isPaymentPlanSettled,
  monthKey,
  planHasStarted,
} from "@/lib/invoice-calc";

describe("computeFinalInvoiceBreakdown", () => {
  it("räknar time × rate / 60 per post", () => {
    const r = computeFinalInvoiceBreakdown(
      [{ minutes: 90, hourlyRate: 150_000 }], // 1,5 tim × 1500 kr = 2250 kr
      [],
      [],
    );
    expect(r.grossAmount).toBe(225_000);
    expect(r.netAmount).toBe(225_000);
  });

  it("utelämnar icke-debiterbara utlägg", () => {
    const r = computeFinalInvoiceBreakdown(
      [],
      [
        { amount: 50_000, billable: true },
        { amount: 30_000, billable: false },
      ],
      [],
    );
    expect(r.grossAmount).toBe(50_000);
  });

  it("drar av accontos från brutto", () => {
    const r = computeFinalInvoiceBreakdown(
      [{ minutes: 600, hourlyRate: 150_000 }], // 10 tim = 15 000 kr
      [],
      [
        { id: "acc1", amount: 500_000 }, // 5000 kr
        { id: "acc2", amount: 300_000 }, // 3000 kr
      ],
    );
    expect(r.grossAmount).toBe(1_500_000);
    expect(r.accontoDeductionTotal).toBe(800_000);
    expect(r.netAmount).toBe(700_000);
    expect(r.deductions).toHaveLength(2);
  });

  it("kastar om netto blir negativt", () => {
    expect(() =>
      computeFinalInvoiceBreakdown(
        [{ minutes: 60, hourlyRate: 100_000 }], // 1000 kr
        [],
        [{ id: "x", amount: 500_000 }], // 5000 kr
      ),
    ).toThrow(/negativ/);
  });

  it("tomma arrays → 0 överallt", () => {
    const r = computeFinalInvoiceBreakdown([], [], []);
    expect(r).toEqual({
      grossAmount: 0,
      accontoDeductionTotal: 0,
      netAmount: 0,
      deductions: [],
    });
  });
});

describe("isPaymentPlanSettled", () => {
  it("false om paidSum < invoiceAmount", () => {
    expect(isPaymentPlanSettled(10_000, 9_999)).toBe(false);
  });
  it("true vid exakt match", () => {
    expect(isPaymentPlanSettled(10_000, 10_000)).toBe(true);
  });
  it("true vid överbetalning", () => {
    expect(isPaymentPlanSettled(10_000, 10_001)).toBe(true);
  });
});

describe("monthKey", () => {
  it("padar månad till tvåsiffrig", () => {
    expect(monthKey(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03");
    expect(monthKey(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});

describe("planHasStarted", () => {
  it("false före startdatum", () => {
    expect(
      planHasStarted(new Date("2026-05-01"), new Date("2026-04-30T12:00:00Z")),
    ).toBe(false);
  });
  it("true på startdatum (samma dag UTC)", () => {
    expect(
      planHasStarted(new Date("2026-05-01"), new Date("2026-05-01T00:00:00Z")),
    ).toBe(true);
  });
  it("true efter startdatum", () => {
    expect(
      planHasStarted(new Date("2026-05-01"), new Date("2026-06-15T00:00:00Z")),
    ).toBe(true);
  });
});
