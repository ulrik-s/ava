/**
 * Faktureringsflöden (#817) — deklarativa flöden, härledd fas och state-maskin.
 */
import { describe, it, expect } from "vitest-compat";
import {
  BILLING_FLOWS, availableActions, currentPhase, pendingBannerFor,
  canBillingTransition, assertBillingTransition, type FlowRun,
} from "@/lib/shared/billing-flow";

const sentFinal: FlowRun = { type: "FINAL", status: "SENT" };
const sentAcconto: FlowRun = { type: "ACCONTO", status: "SENT" };
const pendingKr: FlowRun = { type: "KOSTNADSRAKNING", status: "PENDING_VERDICT" };

describe("currentPhase — härledning", () => {
  it("inga runs → flödets initialfas (ARBETE)", () => {
    expect(currentPhase({ paymentMethod: "PRIVAT" }, [])).toBe("ARBETE");
    expect(currentPhase({ paymentMethod: "RATTSHJALP" }, [])).toBe("ARBETE");
  });

  it("aconto ensam håller kvar i ARBETE (ej slutreglerat)", () => {
    expect(currentPhase({ paymentMethod: "RATTSSKYDD" }, [sentAcconto])).toBe("ARBETE");
  });

  it("kostnadsräkning som väntar på dom → VANTAR_DOM", () => {
    expect(currentPhase({ paymentMethod: "RATTSHJALP" }, [pendingKr])).toBe("VANTAR_DOM");
    expect(currentPhase({ paymentMethod: "OFFENTLIGT_UPPDRAG" }, [pendingKr])).toBe("VANTAR_DOM");
  });

  it("utställd slutfaktura utan väntande → SLUTREGLERAD", () => {
    expect(currentPhase({ paymentMethod: "RATTSSKYDD" }, [sentFinal])).toBe("SLUTREGLERAD");
  });

  it("rättsskydd nekat → NEKAD (även om arbete finns)", () => {
    expect(currentPhase({ paymentMethod: "RATTSSKYDD", rattsskyddNekadAt: "2026-05-01" }, [sentAcconto])).toBe("NEKAD");
  });

  it("PRIVAT saknar SLUTREGLERAD → stannar i ARBETE även efter FINAL (löpande fakturering)", () => {
    expect(currentPhase({ paymentMethod: "PRIVAT" }, [sentFinal])).toBe("ARBETE");
  });
});

describe("availableActions — statemaskinens kanter", () => {
  it("PENDING: inga åtgärder förrän betalningssätt valts", () => {
    expect(availableActions({ paymentMethod: "PENDING" }, [])).toEqual([]);
  });

  it("rättshjälp ARBETE: aconto + kostnadsräkning + slutreglera", () => {
    const types = availableActions({ paymentMethod: "RATTSHJALP" }, []).map((a) => a.type);
    expect(types).toEqual(["ACCONTO", "KOSTNADSRAKNING", "SETTLE"]);
  });

  it("rättshjälp VANTAR_DOM: bara slutreglera (ingen ny kostnadsräkning)", () => {
    const types = availableActions({ paymentMethod: "RATTSHJALP" }, [pendingKr]).map((a) => a.type);
    expect(types).toEqual(["SETTLE"]);
  });

  it("rättsskydd: kostnadsräkning till domstol erbjuds INTE (det är försäkring/slutreglering)", () => {
    const types = availableActions({ paymentMethod: "RATTSSKYDD" }, []).map((a) => a.type);
    expect(types).toEqual(["ACCONTO", "FINAL", "SETTLE"]);
    expect(types).not.toContain("KOSTNADSRAKNING");
  });

  it("nekat rättsskydd: inga faktureringsåtgärder", () => {
    expect(availableActions({ paymentMethod: "RATTSSKYDD", rattsskyddNekadAt: "2026-05-01" }, [])).toEqual([]);
  });

  it("SETTLE-action i rättshjälp öppnar settlement-dialogen", () => {
    const settle = availableActions({ paymentMethod: "RATTSHJALP" }, []).find((a) => a.type === "SETTLE");
    expect(settle?.dialog).toBe("settlement");
  });
});

describe("pendingBannerFor — dom-banner-routing", () => {
  it("rättshjälp i VANTAR_DOM → settlement-banner", () => {
    expect(pendingBannerFor({ paymentMethod: "RATTSHJALP" }, [pendingKr])).toMatchObject({ dialog: "settlement" });
  });

  it("offentligt uppdrag i VANTAR_DOM → verdict-banner (annan modell)", () => {
    expect(pendingBannerFor({ paymentMethod: "OFFENTLIGT_UPPDRAG" }, [pendingKr])).toMatchObject({ dialog: "verdict" });
  });

  it("ingen banner utan väntande kostnadsräkning", () => {
    expect(pendingBannerFor({ paymentMethod: "RATTSHJALP" }, [])).toBeNull();
    expect(pendingBannerFor({ paymentMethod: "PRIVAT" }, [])).toBeNull();
  });
});

describe("canBillingTransition / assertBillingTransition — guards", () => {
  it("tillåtet steg passerar", () => {
    expect(canBillingTransition("RATTSHJALP", "ARBETE", "KOSTNADSRAKNING")).toBe(true);
    expect(() => assertBillingTransition({ paymentMethod: "RATTSHJALP" }, [], "KOSTNADSRAKNING")).not.toThrow();
  });

  it("otillåtet steg kastar (slutreglera privat)", () => {
    expect(canBillingTransition("PRIVAT", "ARBETE", "SETTLE")).toBe(false);
    expect(() => assertBillingTransition({ paymentMethod: "PRIVAT" }, [], "SETTLE")).toThrow(/inte tillåten/);
  });

  it("otillåtet steg kastar (fakturera nekat rättsskydd)", () => {
    expect(() => assertBillingTransition({ paymentMethod: "RATTSSKYDD", rattsskyddNekadAt: "2026-05-01" }, [], "FINAL")).toThrow(/NEKAD/);
  });

  it("varje flöde har en initialfas som finns i actionsByPhase", () => {
    for (const flow of Object.values(BILLING_FLOWS)) {
      expect(flow.initialPhase in flow.actionsByPhase).toBe(true);
    }
  });
});
