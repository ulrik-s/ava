/**
 * Betalningsvillkoret (2026-11-28): byråns antal svenska kalenderdagar efter
 * fakturadagen (#2265), tio om byrån inte har valt något.
 */
import { describe, expect, it } from "vitest-compat";
import { DEFAULT_PAYMENT_TERM_DAYS, defaultDueDate, dueDateOr, paymentTermDaysOf } from "@/lib/shared/billing/payment-terms";
import { stockholmDay } from "@/lib/shared/stockholm-time";

describe("betalningsvillkoret", () => {
  it("är tio dagar", () => {
    expect(DEFAULT_PAYMENT_TERM_DAYS).toBe(10);
  });

  it("förfallodagen är den svenska kalenderdagen tio dagar efter fakturadagen", () => {
    expect(stockholmDay(defaultDueDate(new Date("2026-11-19T09:00:00Z")))).toBe("2026-11-29");
  });

  it("en faktura daterad 23:30 svensk tid räknas från den svenska dagen, inte UTC-dagen", () => {
    // 2026-11-19 22:30 UTC = 2026-11-19 23:30 i Stockholm; 2026-11-19 23:30 UTC = 2026-11-20 00:30.
    expect(stockholmDay(defaultDueDate(new Date("2026-11-19T22:30:00Z")))).toBe("2026-11-29");
    expect(stockholmDay(defaultDueDate(new Date("2026-11-19T23:30:00Z")))).toBe("2026-11-30");
  });

  it("över månads- och årsskifte, och vid sommartidens slut", () => {
    expect(stockholmDay(defaultDueDate(new Date("2026-12-28T10:00:00Z")))).toBe("2027-01-07");
    expect(stockholmDay(defaultDueDate(new Date("2026-10-20T10:00:00Z")))).toBe("2026-10-30");
  });

  it("en angiven förfallodag gäller; utan den gäller villkoret", () => {
    const invoiceDate = new Date("2026-11-19T09:00:00Z");
    expect(dueDateOr("2026-12-31", invoiceDate, 10).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(stockholmDay(dueDateOr(undefined, invoiceDate, 10))).toBe("2026-11-29");
    expect(stockholmDay(dueDateOr(null, invoiceDate, 10))).toBe("2026-11-29");
    expect(stockholmDay(dueDateOr("", invoiceDate, 10))).toBe("2026-11-29");
  });

  it("byråns villkor styr antalet dagar, också 0 (#2265)", () => {
    const invoiceDate = new Date("2026-11-19T09:00:00Z");
    expect(stockholmDay(dueDateOr(undefined, invoiceDate, 30))).toBe("2026-12-19");
    expect(stockholmDay(dueDateOr(undefined, invoiceDate, 0))).toBe("2026-11-19");
  });

  it("byråns villkor: valt antal dagar, annars standarden (#2265)", () => {
    expect(paymentTermDaysOf({ paymentTermDays: 30 })).toBe(30);
    expect(paymentTermDaysOf({ paymentTermDays: 0 })).toBe(0);
    expect(paymentTermDaysOf({ paymentTermDays: null })).toBe(10);
    expect(paymentTermDaysOf({})).toBe(10);
    expect(paymentTermDaysOf(null)).toBe(10);
  });
});
