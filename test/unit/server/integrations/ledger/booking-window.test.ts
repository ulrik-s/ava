/**
 * Bokföringsfönstret (#1035) — spärren mot att e2e:t skriver i skarp bokföring.
 *
 * Fortnox API kan inte ta bort ett verifikat. Ett verifikat som hamnat i fel
 * period går bara att städa manuellt i GUI:t, och bara bakifrån i sin serie.
 * Spärren är därför sista tillfället att stoppa felet — testerna nedan är
 * skrivna som "vad måste vara sant för att spärren ska vara värd namnet".
 */

import { describe, it, expect } from "vitest-compat";
import {
  assertWithinBookingWindow, bookingDateWithin, isWithinBookingWindow,
  parseBookingWindow, withBookingWindow, type BookingWindow,
} from "@/lib/server/integrations/ledger/booking-window";
import type { LedgerConnector, PushVoucherResult, SemanticVoucher } from "@/lib/server/integrations/ledger/port";

const CI_YEAR: BookingWindow = { from: "2030-01-01", to: "2030-12-31" };

function voucher(date: string): SemanticVoucher {
  return {
    date,
    description: "Faktura F-1",
    rows: [
      { role: "kundfordran", debit: 12_500, credit: 0 },
      { role: "intaktArvode", debit: 0, credit: 10_000 },
      { role: "momsUtgaende", debit: 0, credit: 2_500 },
    ],
  };
}

describe("parseBookingWindow", () => {
  it("tolkar ett giltigt fönster", () => {
    expect(parseBookingWindow("2030-01-01..2030-12-31")).toEqual(CI_YEAR);
  });

  // Fail-closed: ett fönster som tyst blir "inget fönster" när variabeln råkar
  // stavas fel skyddar precis så länge ingen gör fel — alltså inte alls.
  it.each([
    ["saknad", undefined],
    ["tom", ""],
    ["utan separator", "2030-01-01"],
    ["skräpdatum", "2030-1-1..2030-12-31"],
    ["tre delar", "2030-01-01..2030-06-30..2030-12-31"],
    ["baklänges", "2030-12-31..2030-01-01"],
  ])("kastar på %s spec", (_label, spec) => {
    expect(() => parseBookingWindow(spec)).toThrow();
  });

  it("felmeddelandet säger vad som förväntades", () => {
    expect(() => parseBookingWindow("nej")).toThrow(/YYYY-MM-DD\.\.YYYY-MM-DD/);
  });
});

describe("isWithinBookingWindow", () => {
  it.each([
    ["första dagen", "2030-01-01", true],
    ["sista dagen", "2030-12-31", true],
    ["mitt i", "2030-06-15", true],
    ["dagen före", "2029-12-31", false],
    ["dagen efter", "2031-01-01", false],
  ])("%s", (_label, date, expected) => {
    expect(isWithinBookingWindow(date, CI_YEAR)).toBe(expected);
  });

  it("tar Date lika väl som sträng", () => {
    expect(isWithinBookingWindow(new Date(2030, 5, 15), CI_YEAR)).toBe(true);
    expect(isWithinBookingWindow(new Date(2026, 5, 15), CI_YEAR)).toBe(false);
  });
});

describe("assertWithinBookingWindow", () => {
  it("släpper igenom ett datum i fönstret", () => {
    expect(() => assertWithinBookingWindow("2030-06-15", CI_YEAR)).not.toThrow();
  });

  it("felet namnger både datumet och fönstret — annars går det inte att felsöka", () => {
    expect(() => assertWithinBookingWindow("2026-08-27", CI_YEAR))
      .toThrow(/2026-08-27.*2030-01-01\.\.2030-12-31/);
  });
});

describe("bookingDateWithin", () => {
  it("behåller dagens datum när det redan ligger i fönstret", () => {
    expect(bookingDateWithin(CI_YEAR, new Date(2030, 2, 9))).toBe("2030-03-09");
  });

  it("flyttar året men behåller månad/dag — verifikaten sprids över CI-året", () => {
    expect(bookingDateWithin(CI_YEAR, new Date(2026, 7, 27))).toBe("2030-08-27");
  });

  it("klampar till start när det flyttade datumet ändå faller utanför", () => {
    const kvartal: BookingWindow = { from: "2030-01-01", to: "2030-03-31" };
    expect(bookingDateWithin(kvartal, new Date(2026, 7, 27))).toBe("2030-01-01");
  });

  // 2030 är inget skottår. Utan kontrollen hade en körning den 29 februari
  // 2028 daterat verifikatet 2030-02-29 — en dag som inte finns, och som
  // Fortnox avvisar.
  it("klampar hellre än att hitta på den 29 februari i ett icke-skottår", () => {
    expect(bookingDateWithin(CI_YEAR, new Date(2028, 1, 29))).toBe("2030-01-01");
  });

  it("behåller den 29 februari när målåret ÄR ett skottår", () => {
    const skottar: BookingWindow = { from: "2032-01-01", to: "2032-12-31" };
    expect(bookingDateWithin(skottar, new Date(2028, 1, 29))).toBe("2032-02-29");
  });

  it("resultatet ligger alltid i fönstret", () => {
    for (const month of [0, 3, 6, 11]) {
      const d = bookingDateWithin(CI_YEAR, new Date(2026, month, 15));
      expect(isWithinBookingWindow(d, CI_YEAR), d).toBe(true);
    }
  });
});

/** Connector som registrerar vad den fick — och som INTE ska ha fått något
 *  när spärren slår till. */
function spy(): { inner: LedgerConnector; pushed: SemanticVoucher[] } {
  const pushed: SemanticVoucher[] = [];
  const inner: LedgerConnector = {
    name: "spion",
    capabilities: () => ({ pushVoucher: true, pushInvoice: false, pullPayments: false, exportSie: false }),
    pushVoucher: async (v): Promise<PushVoucherResult> => {
      pushed.push(v);
      return { externalId: "Z/1" };
    },
  };
  return { inner, pushed };
}

describe("withBookingWindow", () => {
  const ctx = { idempotencyKey: "k" };

  it("släpper igenom ett verifikat i fönstret", async () => {
    const { inner, pushed } = spy();
    const res = await withBookingWindow(inner, CI_YEAR).pushVoucher?.(voucher("2030-06-15"), ctx);
    expect(res).toEqual({ externalId: "Z/1" });
    expect(pushed).toHaveLength(1);
  });

  it("avvisar utanför fönstret UTAN att nå connectorn — inget får skickas", async () => {
    const { inner, pushed } = spy();
    const guarded = withBookingWindow(inner, CI_YEAR);
    await expect(guarded.pushVoucher?.(voucher("2026-08-27"), ctx)).rejects.toThrow(/utanför tillåtet fönster/);
    expect(pushed, "verifikatet nådde connectorn trots spärren").toHaveLength(0);
  });

  it("bevarar namn och capabilities", () => {
    const guarded = withBookingWindow(spy().inner, CI_YEAR);
    expect(guarded.name).toBe("spion");
    expect(guarded.capabilities().pushVoucher).toBe(true);
  });

  // Invarianten i port.ts: flagga true ⟺ metod finns. En dekoratör som lade
  // till metoder inner saknar hade brutit den.
  it("lägger inte till metoder som inner saknar", () => {
    const guarded = withBookingWindow(spy().inner, CI_YEAR);
    expect(guarded.pushInvoice).toBeUndefined();
    expect(guarded.pullPayments).toBeUndefined();
    expect(guarded.exportSie).toBeUndefined();
  });

  it("skickar vidare de metoder inner HAR, orörda", async () => {
    const inner: LedgerConnector = {
      name: "full",
      capabilities: () => ({ pushVoucher: false, pushInvoice: true, pullPayments: true, exportSie: true }),
      pushInvoice: async () => ({ externalId: "F-1" }),
      pullPayments: async () => [],
      exportSie: async () => "#FLAGGA 0",
    };
    const guarded = withBookingWindow(inner, CI_YEAR);
    expect(guarded.pushVoucher).toBeUndefined();
    expect(await guarded.exportSie?.({ from: "2030-01-01", to: "2030-12-31" })).toBe("#FLAGGA 0");
    expect(await guarded.pullPayments?.({ since: "2030-01-01" })).toEqual([]);
    expect(await guarded.pushInvoice?.({
      invoiceNumber: "F-1", invoiceDate: "2030-01-01", amount: 100, vatRate: 2500, customerName: "K",
    })).toEqual({ externalId: "F-1" });
  });
});
