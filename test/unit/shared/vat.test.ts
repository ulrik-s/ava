import { describe, it, expect } from "vitest-compat";
import { splitVat, isVatRate, VAT_RATES, DEFAULT_VAT_RATE } from "@/lib/shared/vat";

describe("splitVat", () => {
  // ─── 25 % (default) ──────────────────────────────────────────────
  it("125 öre inkl 25 % → 100 exkl + 25 moms + 125 inkl", () => {
    expect(splitVat({ amount: 125, vatRate: 2500, vatIncluded: true })).toEqual({
      exclVat: 100, vat: 25, inclVat: 125,
    });
  });

  it("100 öre exkl 25 % → 100 + 25 + 125", () => {
    expect(splitVat({ amount: 100, vatRate: 2500, vatIncluded: false })).toEqual({
      exclVat: 100, vat: 25, inclVat: 125,
    });
  });

  // ─── 0 % (momsfritt) ─────────────────────────────────────────────
  it("0 % → exkl = inkl = amount, vat = 0", () => {
    const a = splitVat({ amount: 500, vatRate: 0, vatIncluded: true });
    expect(a).toEqual({ exclVat: 500, vat: 0, inclVat: 500 });
    const b = splitVat({ amount: 500, vatRate: 0, vatIncluded: false });
    expect(b).toEqual({ exclVat: 500, vat: 0, inclVat: 500 });
  });

  // ─── 6 % och 12 % ────────────────────────────────────────────────
  it("106 öre inkl 6 % → 100 + 6 + 106", () => {
    expect(splitVat({ amount: 106, vatRate: 600, vatIncluded: true })).toEqual({
      exclVat: 100, vat: 6, inclVat: 106,
    });
  });

  it("112 öre inkl 12 % → 100 + 12 + 112", () => {
    expect(splitVat({ amount: 112, vatRate: 1200, vatIncluded: true })).toEqual({
      exclVat: 100, vat: 12, inclVat: 112,
    });
  });

  // ─── Rundning ────────────────────────────────────────────────────
  it("rundningsfel ligger på ≤ 1 öre och balanserar", () => {
    // 333 öre inkl 25 % = 266.4 exkl + 66.6 moms — bör runda till heltal
    const r = splitVat({ amount: 333, vatRate: 2500, vatIncluded: true });
    expect(r.exclVat + r.vat).toBe(r.inclVat);
    expect(r.inclVat).toBe(333);
    expect(r.exclVat).toBe(266);
    expect(r.vat).toBe(67);
  });

  it("exkl→inkl rundas symmetriskt", () => {
    const r = splitVat({ amount: 266, vatRate: 2500, vatIncluded: false });
    expect(r.exclVat).toBe(266);
    expect(r.vat).toBe(67); // 266 * 0.25 = 66.5 → 67
    expect(r.inclVat).toBe(333);
  });

  // ─── Stora belopp ────────────────────────────────────────────────
  it("hanterar belopp i tusentals kronor utan precision-förlust", () => {
    // 12_500 kr inkl 25 % = 10_000 exkl + 2_500 moms
    const r = splitVat({ amount: 1_250_000, vatRate: 2500, vatIncluded: true });
    expect(r.exclVat).toBe(1_000_000);
    expect(r.vat).toBe(250_000);
    expect(r.inclVat).toBe(1_250_000);
  });

  // ─── Noll och negativa edge cases ────────────────────────────────
  it("0 öre → 0/0/0", () => {
    expect(splitVat({ amount: 0, vatRate: 2500, vatIncluded: true })).toEqual({
      exclVat: 0, vat: 0, inclVat: 0,
    });
  });

  it("negativt belopp (kreditering) hanteras", () => {
    expect(splitVat({ amount: -125, vatRate: 2500, vatIncluded: true })).toEqual({
      exclVat: -100, vat: -25, inclVat: -125,
    });
  });
});

describe("isVatRate", () => {
  it("godkänner alla tillåtna satser", () => {
    for (const r of VAT_RATES) expect(isVatRate(r)).toBe(true);
  });
  it("avvisar andra siffror", () => {
    expect(isVatRate(25)).toBe(false); // procent istället för bps
    expect(isVatRate(2400)).toBe(false);
    expect(isVatRate("2500")).toBe(false);
    expect(isVatRate(null)).toBe(false);
  });
});

describe("DEFAULT_VAT_RATE", () => {
  it("är 25 % (advokattjänsters standardmoms)", () => {
    expect(DEFAULT_VAT_RATE).toBe(2500);
  });
});
