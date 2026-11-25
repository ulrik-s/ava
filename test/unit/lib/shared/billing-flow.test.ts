/**
 * Faktureringsflöden (#817) — deklarativa flöden, härledd fas och state-maskin.
 */
import { describe, it, expect } from "vitest-compat";
import {
  BILLING_FLOWS, COVERAGE_METHODS, availableActions, currentPhase, isCoverageMethod,
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

  it("VANTAR_DOM för inskickad, beslutad, överklagad och äldre KR utan status och faktura (#1859)", () => {
    for (const kostnadsrakningStatus of ["INSKICKAD", "BESLUTAD", "OVERKLAGAD", null] as const) {
      expect(currentPhase({ paymentMethod: "RATTSHJALP" }, [{ ...pendingKr, kostnadsrakningStatus }])).toBe("VANTAR_DOM");
    }
  });

  it("inte VANTAR_DOM för fakturerad eller ångrad KR (#1859)", () => {
    const fakturerad: FlowRun = { type: "KOSTNADSRAKNING", status: "SENT", kostnadsrakningStatus: "FAKTURERAD", invoiceId: "inv-1" };
    expect(currentPhase({ paymentMethod: "RATTSHJALP" }, [fakturerad])).toBe("SLUTREGLERAD");
    expect(currentPhase({ paymentMethod: "RATTSHJALP" }, [{ ...pendingKr, status: "VOIDED", kostnadsrakningStatus: "INSKICKAD" }])).toBe("ARBETE");
    expect(currentPhase({ paymentMethod: "RATTSHJALP" }, [{ ...pendingKr, kostnadsrakningStatus: null, invoiceId: "inv-1" }])).toBe("ARBETE");
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
  it("PENDING: som PRIVAT — aconto och faktura till klient medan beslut väntar (#1730)", () => {
    const pending = availableActions({ paymentMethod: "PENDING" }, []);
    expect(pending).toEqual(availableActions({ paymentMethod: "PRIVAT" }, []));
    expect(pending.map((a) => a.label)).toEqual(["Aconto till klient", "Faktura till klient"]);
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

describe("isCoverageMethod (#1852)", () => {
  it("rättshjälp och rättsskydd, inget annat", () => {
    expect([...COVERAGE_METHODS].sort()).toEqual(["RATTSHJALP", "RATTSSKYDD"]);
    expect(isCoverageMethod("RATTSHJALP")).toBe(true);
    expect(isCoverageMethod("RATTSSKYDD")).toBe(true);
    for (const m of ["PRIVAT", "MIX", "PENDING", "OFFENTLIGT_UPPDRAG", null, undefined] as const) expect(isCoverageMethod(m)).toBe(false);
  });
});
