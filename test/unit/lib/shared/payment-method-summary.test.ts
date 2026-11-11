/**
 * Betalningsraden i ärendehuvudet (#1518): etikett + försäkringsbolag + klientens andel.
 */

import { describe, it, expect } from "vitest-compat";
import { paymentMethodSummary } from "@/lib/shared/payment-method-summary";

describe("paymentMethodSummary", () => {
  it("rättsskydd med bolag och andel", () => {
    expect(paymentMethodSummary({ paymentMethod: "RATTSSKYDD", insurerName: "Bolaget", clientShareBips: 2000 }))
      .toBe("Rättsskydd · Bolaget · klienten betalar 20 %");
  });

  it("rättsskydd utan bolag visar bara andelen, utan tom avgränsare", () => {
    expect(paymentMethodSummary({ paymentMethod: "RATTSSKYDD", clientShareBips: 2000 }))
      .toBe("Rättsskydd · klienten betalar 20 %");
    expect(paymentMethodSummary({ paymentMethod: "RATTSSKYDD", insurerName: "", clientShareBips: 2000 }))
      .toBe("Rättsskydd · klienten betalar 20 %");
  });

  it("rättsskydd utan andel visar bara bolaget", () => {
    expect(paymentMethodSummary({ paymentMethod: "RATTSSKYDD", insurerName: "Bolaget", clientShareBips: null }))
      .toBe("Rättsskydd · Bolaget");
  });

  it("rättsskydd utan bolag och andel visar bara etiketten", () => {
    expect(paymentMethodSummary({ paymentMethod: "RATTSSKYDD" })).toBe("Rättsskydd");
  });

  it("rättshjälp med andel (även bråkdelar av procent och 0 %)", () => {
    expect(paymentMethodSummary({ paymentMethod: "RATTSHJALP", clientShareBips: 1000 }))
      .toBe("Rättshjälp · klienten betalar 10 %");
    expect(paymentMethodSummary({ paymentMethod: "RATTSHJALP", clientShareBips: 250 }))
      .toBe("Rättshjälp · klienten betalar 2,5 %");
    expect(paymentMethodSummary({ paymentMethod: "RATTSHJALP", clientShareBips: 0 }))
      .toBe("Rättshjälp · klienten betalar 0 %");
  });

  it("rättshjälp utan andel visar bara etiketten, och aldrig ett försäkringsbolag", () => {
    expect(paymentMethodSummary({ paymentMethod: "RATTSHJALP", insurerName: "Bolaget" })).toBe("Rättshjälp");
  });

  it("övriga betalningssätt visar bara etiketten", () => {
    const rest = { insurerName: "Bolaget", clientShareBips: 2000 };
    expect(paymentMethodSummary({ paymentMethod: "PRIVAT", ...rest })).toBe("Privat betalning");
    expect(paymentMethodSummary({ paymentMethod: "OFFENTLIGT_UPPDRAG", ...rest })).toBe("Offentligt uppdrag");
    expect(paymentMethodSummary({ paymentMethod: "MIX", ...rest })).toBe("Kombinerad");
    expect(paymentMethodSummary({ paymentMethod: "PENDING", ...rest })).toBe("Ej fastställt");
  });
});
