import { describe, it, expect } from "vitest-compat";
import {
  computeFinalInvoiceBreakdown,
  isPaymentPlanSettled,
  monthKey,
  planHasStarted,
} from "@/lib/shared/invoice-calc";

describe("computeFinalInvoiceBreakdown", () => {
  it("räknar time × rate / 60 per post + 25 % moms på arvodet (#782), momsen i hela kronor (#1438)", () => {
    const r = computeFinalInvoiceBreakdown(
      [{ minutes: 90, hourlyRate: 150_000 }], // 1,5 tim × 1500 kr = 2250 kr exkl
      [],
      [],
    );
    // 25 % av 2 250 kr = 562,50 kr → 563 kr (50 öre avrundas uppåt).
    expect(r.grossAmount).toBe(281_300);
    expect(r.arvodeVatOre).toBe(56_300);
    expect(r.netAmount).toBe(281_300);
  });

  it("varje tidspost avrundas till hela kronor innan summering (#1438)", () => {
    // 7 min × 1 000 kr/h = 116,67 kr → 117 kr; två poster = 234 kr (inte 233,33 → 233).
    const r = computeFinalInvoiceBreakdown(
      [{ minutes: 7, hourlyRate: 100_000 }, { minutes: 7, hourlyRate: 100_000 }], [], [],
    );
    expect(r.grossAmount - r.arvodeVatOre).toBe(23_400);
    expect(r.arvodeVatOre).toBe(5_900); // 25 % av 234 = 58,50 → 59 kr
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
    // #975: det debiterbara utlägget (500 kr netto) är ett kostnadselement i
    // uppdraget och debiteras vidare med 25 % → 625 kr. Det icke-debiterbara
    // utelämnas, vilket är vad testet vaktar. Förr gav helpern 50 000 rakt av,
    // eftersom `vatIncluded` defaultade till `true` — en kvarleva från före #782,
    // då utlägg lagrades brutto.
    expect(r.grossAmount).toBe(62_500);
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
    expect(r.grossAmount).toBe(1_875_000); // 15 000 kr + 25 % moms
    expect(r.arvodeVatOre).toBe(375_000);
    expect(r.accontoDeductionTotal).toBe(800_000);
    expect(r.netAmount).toBe(1_075_000);
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
      arvodeVatOre: 0,
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
