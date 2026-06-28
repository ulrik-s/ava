/**
 * Kostnadsräkningens state-maskin (#829): KR→Beslut→Faktura + överklagan-grenen.
 */
import { describe, it, expect } from "vitest-compat";
import {
  availableKrActions, canKrAction, applyKrAction,
  type KostnadsrakningState,
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
