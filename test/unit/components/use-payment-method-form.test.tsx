/**
 * Enhetstest för betalningsdelens formulär-state (#1564): startvärden ur
 * ärendet och omvandlingen till `matter.update`-indata, samma som
 * `PaymentMethodEditor` gjorde innan utbrytningen.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import {
  paymentFormFromMatter,
  paymentUpdateInput,
  usePaymentMethodForm,
  type PaymentMethodFormValues,
  type PaymentMethodInitial,
} from "@/components/matter/use-payment-method-form";

const EMPTY: PaymentMethodInitial = {
  paymentMethod: "PRIVAT",
  paymentMethodNote: null,
  paymentMethodDecidedAt: null,
  clientShareBips: null,
  rattsskyddMaxOre: null,
  rattshjalpMaxTimmar: null,
};

function values(over: Partial<PaymentMethodFormValues>): PaymentMethodFormValues {
  return { ...paymentFormFromMatter(EMPTY), ...over };
}

describe("paymentFormFromMatter", () => {
  it("tomma uppgifter ger tomma fält och en tom timpriskarta", () => {
    expect(paymentFormFromMatter(EMPTY)).toEqual({
      method: "PRIVAT", note: "", decidedAt: "", sharePct: "", rsMaxKr: "", rhMaxTim: "",
      tvist: "", beslut: "", nekad: "", rates: {},
    });
  });

  it("sparade värden visas som procent, kronor, timmar och ISO-datum", () => {
    expect(paymentFormFromMatter({
      paymentMethod: "RATTSSKYDD",
      paymentMethodNote: "Bolag X",
      paymentMethodDecidedAt: new Date("2026-03-02T00:00:00Z"),
      clientShareBips: 2550,
      rattsskyddMaxOre: 7500000,
      rattshjalpMaxTimmar: 120,
      tvistUppkomDatum: "2026-01-05T00:00:00Z",
      rattsskyddBeslutDatum: new Date("2026-02-01T00:00:00Z"),
      rattsskyddNekadAt: "2026-04-01T00:00:00Z",
      hourlyRates: { ARBETE: 300000 },
    })).toEqual({
      method: "RATTSSKYDD", note: "Bolag X", decidedAt: "2026-03-02", sharePct: "25.5",
      rsMaxKr: "75000", rhMaxTim: "120", tvist: "2026-01-05", beslut: "2026-02-01",
      nekad: "2026-04-01", rates: { ARBETE: 300000 },
    });
  });
});

describe("paymentUpdateInput", () => {
  it("rättsskydd: andel i bips, tak i öre (mellanslag och komma tillåts) och datum", () => {
    expect(paymentUpdateInput(values({
      method: "RATTSSKYDD", note: "Bolag X", decidedAt: "2026-03-02", sharePct: " 25,5 ",
      rsMaxKr: "75 000,50", tvist: "2026-01-05", beslut: "2026-02-01", nekad: "2026-04-01",
      rates: { ARBETE: 300000 },
    }))).toEqual({
      paymentMethod: "RATTSSKYDD",
      paymentMethodNote: "Bolag X",
      paymentMethodDecidedAt: "2026-03-02",
      clientShareBips: 2550,
      rattsskyddMaxOre: 7500050,
      rattshjalpMaxTimmar: null,
      tvistUppkomDatum: "2026-01-05",
      rattsskyddBeslutDatum: "2026-02-01",
      rattsskyddNekadAt: "2026-04-01",
      hourlyRates: { ARBETE: 300000 },
    });
  });

  it("rättshjälp: timtaket avrundas till heltal", () => {
    const input = paymentUpdateInput(values({ method: "RATTSHJALP", sharePct: "2", rhMaxTim: "120,4" }));
    expect(input).toMatchObject({ paymentMethod: "RATTSHJALP", clientShareBips: 200, rattshjalpMaxTimmar: 120 });
  });

  it("privat: tomma fält blir null", () => {
    expect(paymentUpdateInput(values({}))).toEqual({
      paymentMethod: "PRIVAT",
      paymentMethodNote: null,
      paymentMethodDecidedAt: null,
      clientShareBips: null,
      rattsskyddMaxOre: null,
      rattshjalpMaxTimmar: null,
      tvistUppkomDatum: null,
      rattsskyddBeslutDatum: null,
      rattsskyddNekadAt: null,
      hourlyRates: {},
    });
  });

  it.each([
    ["andel över 100 %", { sharePct: "150" }, "clientShareBips"],
    ["negativ andel", { sharePct: "-1" }, "clientShareBips"],
    ["andel som inte är ett tal", { sharePct: "abc" }, "clientShareBips"],
    ["negativt tak i kr", { rsMaxKr: "-5" }, "rattsskyddMaxOre"],
    ["tak i kr som inte är ett tal", { rsMaxKr: "x" }, "rattsskyddMaxOre"],
    ["timtak noll", { rhMaxTim: "0" }, "rattshjalpMaxTimmar"],
    ["timtak som inte är ett tal", { rhMaxTim: "många" }, "rattshjalpMaxTimmar"],
  ] as const)("ogiltigt värde (%s) blir null", (_name, over, key) => {
    expect(paymentUpdateInput(values(over))[key]).toBeNull();
  });

  it("andelen 0 % och 100 % är giltiga gränsvärden", () => {
    expect(paymentUpdateInput(values({ sharePct: "0" })).clientShareBips).toBe(0);
    expect(paymentUpdateInput(values({ sharePct: "100" })).clientShareBips).toBe(10000);
  });

  it("mellanslag inne i ett tal tolkas som tusentalsavgränsning, som i övriga talfält", () => {
    const input = paymentUpdateInput(values({ sharePct: "1 2", rhMaxTim: "1 20" }));
    expect(input).toMatchObject({ clientShareBips: 1200, rattshjalpMaxTimmar: 120 });
  });
});

describe("usePaymentMethodForm", () => {
  it("startar ur ärendet och bygger indata ur de senast satta värdena", () => {
    const { result } = renderHook(() => usePaymentMethodForm({ ...EMPTY, clientShareBips: 2500 }));
    expect(result.current.values.sharePct).toBe("25");
    act(() => result.current.setValues({ ...result.current.values, method: "RATTSHJALP", rhMaxTim: "80" }));
    expect(result.current.toUpdateInput()).toMatchObject({
      paymentMethod: "RATTSHJALP", clientShareBips: 2500, rattshjalpMaxTimmar: 80,
    });
  });
});
