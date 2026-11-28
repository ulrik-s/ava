/**
 * Betalningsvillkoret (2026-11-28): tio svenska kalenderdagar efter fakturadagen.
 */
import { describe, expect, it } from "vitest-compat";
import { DEFAULT_PAYMENT_TERM_DAYS, defaultDueDate, dueDateOr } from "@/lib/shared/billing/payment-terms";
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
    expect(dueDateOr("2026-12-31", invoiceDate).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(stockholmDay(dueDateOr(undefined, invoiceDate))).toBe("2026-11-29");
    expect(stockholmDay(dueDateOr(null, invoiceDate))).toBe("2026-11-29");
    expect(stockholmDay(dueDateOr("", invoiceDate))).toBe("2026-11-29");
  });
});
