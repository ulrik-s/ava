import { describe, it, expect } from "vitest-compat";
import { hasVatBreakdown, invoiceVatOre } from "@/lib/shared/invoice-vat";

describe("hasVatBreakdown", () => {
  it("falsk för null, undefined och tom lista", () => {
    expect(hasVatBreakdown({ amount: 100, vatBreakdown: null })).toBe(false);
    expect(hasVatBreakdown({ amount: 100, vatBreakdown: undefined })).toBe(false);
    expect(hasVatBreakdown({ amount: 100 })).toBe(false);
    expect(hasVatBreakdown({ amount: 100, vatBreakdown: [] })).toBe(false);
  });

  it("sann för en lista med rader, och smalnar av typen", () => {
    const invoice: { amount: number; vatBreakdown?: { vatOre: number }[] | null } = {
      amount: 125, vatBreakdown: [{ vatOre: 25 }],
    };
    expect(hasVatBreakdown(invoice)).toBe(true);
    if (hasVatBreakdown(invoice)) expect(invoice.vatBreakdown.length).toBe(1);
  });
});

describe("invoiceVatOre", () => {
  it("uppdelningen finns → summan av radernas moms, även när vatOre säger annat", () => {
    expect(invoiceVatOre({ amount: 15_000, vatOre: 9_999, vatBreakdown: [{ vatOre: 2_500 }, { vatOre: 500 }] })).toBe(3_000);
  });

  it("tom uppdelning räknas som saknad → vatOre", () => {
    expect(invoiceVatOre({ amount: 10_600, vatOre: 600, vatBreakdown: [] })).toBe(600);
  });

  it("bara vatOre → vatOre, utan klippning", () => {
    expect(invoiceVatOre({ amount: 10_600, vatOre: 600 })).toBe(600);
    expect(invoiceVatOre({ amount: 100, vatOre: 500 })).toBe(500);
  });

  it("vatOre null → 25 %-split av beloppet", () => {
    expect(invoiceVatOre({ amount: 12_500, vatOre: null })).toBe(2_500);
    expect(invoiceVatOre({ amount: 0, vatOre: null })).toBe(0);
  });

  it("kredit utan vatOre → negativ moms", () => {
    expect(invoiceVatOre({ amount: -12_500 })).toBe(-2_500);
  });

  it("en annan fallbackRate används i reserven", () => {
    expect(invoiceVatOre({ amount: 10_600 }, 600)).toBe(600);
    expect(invoiceVatOre({ amount: 10_600 }, 0)).toBe(0);
  });
});
