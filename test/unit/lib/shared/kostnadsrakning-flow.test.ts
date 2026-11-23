/**
 * Kostnadsräkningens state-maskin (#829): KR→Beslut→Faktura + överklagan-grenen.
 */
import { describe, it, expect } from "vitest-compat";
import {
  availableKrActions, canKrAction, applyKrAction, isActiveKr, krStateOf,
  type ActiveKrSource, type KostnadsrakningState,
} from "@/lib/shared/kostnadsrakning-flow";

const inskickad: KostnadsrakningState = { status: "INSKICKAD", slutgiltigt: false };

describe("availableKrActions", () => {
  it("INSKICKAD → bara registrera beslut", () => {
    expect(availableKrActions(inskickad)).toEqual(["REGISTRERA_BESLUT"]);
  });

  it("BESLUTAD (ej slutgiltigt) → skapa faktura ELLER överklaga", () => {
    expect(availableKrActions({ status: "BESLUTAD", slutgiltigt: false })).toEqual(["SKAPA_FAKTURA", "OVERKLAGA"]);
  });

  it("BESLUTAD slutgiltigt (efter hovrätten) → bara faktura, ingen ny överklagan", () => {
    expect(availableKrActions({ status: "BESLUTAD", slutgiltigt: true })).toEqual(["SKAPA_FAKTURA"]);
  });

  it("ÖVERKLAGAD → bara registrera hovrättens beslut", () => {
    expect(availableKrActions({ status: "OVERKLAGAD", slutgiltigt: false })).toEqual(["REGISTRERA_HOVRATT_BESLUT"]);
  });

  it("FAKTURERAD → inga åtgärder (terminalt)", () => {
    expect(availableKrActions({ status: "FAKTURERAD", slutgiltigt: true })).toEqual([]);
  });
});

describe("applyKrAction — övergångar", () => {
  it("hela vägen utan överklagan: inskickad → beslutad → fakturerad", () => {
    const beslutad = applyKrAction(inskickad, "REGISTRERA_BESLUT");
    expect(beslutad).toEqual({ status: "BESLUTAD", slutgiltigt: false });
    const fakturerad = applyKrAction(beslutad, "SKAPA_FAKTURA");
    expect(fakturerad).toEqual({ status: "FAKTURERAD", slutgiltigt: false });
  });

  it("överklagan-grenen: beslutad → överklagad → hovrättsbeslut (slutgiltigt) → fakturerad", () => {
    const beslutad = applyKrAction(inskickad, "REGISTRERA_BESLUT");
    const overklagad = applyKrAction(beslutad, "OVERKLAGA");
    expect(overklagad.status).toBe("OVERKLAGAD");
    const slutgiltig = applyKrAction(overklagad, "REGISTRERA_HOVRATT_BESLUT");
    expect(slutgiltig).toEqual({ status: "BESLUTAD", slutgiltigt: true });
    // Får inte överklaga igen
    expect(canKrAction(slutgiltig, "OVERKLAGA")).toBe(false);
    expect(applyKrAction(slutgiltig, "SKAPA_FAKTURA").status).toBe("FAKTURERAD");
  });

  it("kastar vid otillåten övergång (faktura innan beslut)", () => {
    expect(() => applyKrAction(inskickad, "SKAPA_FAKTURA")).toThrow(/inte tillåten/);
  });

  it("kastar vid dubbel överklagan (slutgiltigt beslut)", () => {
    expect(() => applyKrAction({ status: "BESLUTAD", slutgiltigt: true }, "OVERKLAGA")).toThrow(/inte tillåten/);
  });
});

// ─── Livscykeln ur en lagrad körning (#1859) ────────────────────────────────

/** En kostnadsräkning som väntar på domstolen; `extra` ersätter fälten. */
const krRun = (extra: Partial<ActiveKrSource> = {}): ActiveKrSource => ({
  type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", kostnadsrakningStatus: null, ...extra,
});

describe("krStateOf — en tolkning av en äldre kostnadsräkning utan status", () => {
  it("null + PENDING_VERDICT → INSKICKAD", () => {
    expect(krStateOf(krRun()).status).toBe("INSKICKAD");
  });

  it("null + faktura → FAKTURERAD", () => {
    expect(krStateOf(krRun({ invoiceId: "inv-1" })).status).toBe("FAKTURERAD");
  });

  it("null + SENT utan faktura → FAKTURERAD", () => {
    expect(krStateOf(krRun({ status: "SENT" })).status).toBe("FAKTURERAD");
  });

  it("ett satt värde vinner över status och faktura", () => {
    expect(krStateOf(krRun({ kostnadsrakningStatus: "BESLUTAD", status: "SENT", invoiceId: "inv-1" })).status).toBe("BESLUTAD");
    expect(krStateOf(krRun({ kostnadsrakningStatus: "FAKTURERAD" })).status).toBe("FAKTURERAD");
  });

  it("slutgiltigt följer beslutSlutgiltigt, annars false", () => {
    expect(krStateOf(krRun({ kostnadsrakningStatus: "BESLUTAD", beslutSlutgiltigt: true })).slutgiltigt).toBe(true);
    expect(krStateOf(krRun()).slutgiltigt).toBe(false);
  });
});

describe("isActiveKr", () => {
  it("inskickad, överklagad och beslutad KR är aktiv", () => {
    expect(isActiveKr(krRun({ kostnadsrakningStatus: "INSKICKAD" }))).toBe(true);
    expect(isActiveKr(krRun({ kostnadsrakningStatus: "OVERKLAGAD" }))).toBe(true);
    expect(isActiveKr(krRun({ kostnadsrakningStatus: "BESLUTAD" }))).toBe(true);
  });

  it("ångrad eller fakturerad KR är inte aktiv", () => {
    expect(isActiveKr(krRun({ kostnadsrakningStatus: "INSKICKAD", status: "VOIDED" }))).toBe(false);
    expect(isActiveKr(krRun({ kostnadsrakningStatus: "FAKTURERAD", status: "SENT" }))).toBe(false);
  });

  it("äldre KR utan status: aktiv utan faktura, inte aktiv med faktura eller skickad", () => {
    expect(isActiveKr(krRun())).toBe(true);
    expect(isActiveKr(krRun({ invoiceId: "inv-1" }))).toBe(false);
    expect(isActiveKr(krRun({ status: "SENT" }))).toBe(false);
    expect(isActiveKr(krRun({ status: "VOIDED" }))).toBe(false);
  });

  it("andra körningstyper är aldrig en aktiv KR", () => {
    expect(isActiveKr({ type: "FINAL", status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD" })).toBe(false);
  });
});
