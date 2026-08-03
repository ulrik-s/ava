/**
 * Byråns standardåtgärder (#956) — urvalslogiken. Poängen med hela funktionen är
 * att ALLA på byrån ser samma lista i samma ordning; går urvalet isär mellan
 * jurister får kostnadsräkningarna olika ordalydelse för samma åtgärd, vilket är
 * precis det problem åtgärderna ska lösa.
 */
import { describe, it, expect } from "vitest-compat";
import {
  applicableStandardAtgarder, normalizeStandardAtgarder, type StandardAtgard,
} from "@/lib/shared/standard-atgard";

const atgard = (over: Partial<StandardAtgard> & { id: string }): StandardAtgard => ({
  description: `Åtgärd ${over.id}`, minutes: 30, kind: "ARBETE", stage: "ANY",
  paymentMethods: [], billable: true, active: true, ...over,
});

describe("applicableStandardAtgarder", () => {
  it("returnerar bara AKTIVA åtgärder — avställda finns kvar men föreslås inte", () => {
    const list = [atgard({ id: "a" }), atgard({ id: "b", active: false })];
    expect(applicableStandardAtgarder(list, "PRIVAT").map((a) => a.id)).toEqual(["a"]);
  });

  it("tom paymentMethods = gäller ALLA betalningssätt (normalfallet)", () => {
    const list = [atgard({ id: "alla" })];
    for (const m of ["PRIVAT", "RATTSHJALP", "RATTSSKYDD", "OFFENTLIGT_UPPDRAG"] as const) {
      expect(applicableStandardAtgarder(list, m).map((a) => a.id)).toEqual(["alla"]);
    }
    // Även utan känt betalningssätt (nytt ärende, PENDING) ska den föreslås.
    expect(applicableStandardAtgarder(list, null).map((a) => a.id)).toEqual(["alla"]);
  });

  it("begränsad åtgärd gäller BARA sina betalningssätt", () => {
    const list = [atgard({ id: "bara-rh", paymentMethods: ["RATTSHJALP"] })];
    expect(applicableStandardAtgarder(list, "RATTSHJALP").map((a) => a.id)).toEqual(["bara-rh"]);
    expect(applicableStandardAtgarder(list, "PRIVAT")).toEqual([]);
    // Okänt betalningssätt får inte råka matcha en begränsad åtgärd.
    expect(applicableStandardAtgarder(list, null)).toEqual([]);
  });

  it("filtrerar på skede när det anges — förslagsvägen", () => {
    const list = [
      atgard({ id: "start", stage: "OPENING" }),
      atgard({ id: "slut", stage: "CLOSING" }),
      atgard({ id: "lopande", stage: "ANY" }),
    ];
    expect(applicableStandardAtgarder(list, "PRIVAT", "CLOSING").map((a) => a.id)).toEqual(["slut"]);
    // Utan skede: alla tillämpliga (väljaren i tidsformuläret).
    expect(applicableStandardAtgarder(list, "PRIVAT")).toHaveLength(3);
  });

  it("ordnas i skede-ordning, därefter beskrivning på svenska", () => {
    const list = [
      atgard({ id: "3", stage: "CLOSING", description: "Avslutande åtgärder" }),
      atgard({ id: "2", stage: "ANY", description: "Överklagande" }),
      atgard({ id: "1", stage: "OPENING", description: "Inledande åtgärder" }),
      atgard({ id: "2b", stage: "ANY", description: "Ändring av talan" }),
    ];
    // Skede först (inledande → löpande → avslutande); inom skedet svensk
    // kollation, där Ä/Ö sorteras efter Z — inte som A/O.
    expect(applicableStandardAtgarder(list, "PRIVAT").map((a) => a.id)).toEqual(["1", "2b", "2", "3"]);
  });

  it("tom/saknad lista ger tom lista (byrå som inte satt upp några)", () => {
    expect(applicableStandardAtgarder([], "PRIVAT")).toEqual([]);
    expect(applicableStandardAtgarder(null, "PRIVAT")).toEqual([]);
    expect(applicableStandardAtgarder(undefined, "PRIVAT")).toEqual([]);
  });
});

describe("normalizeStandardAtgarder", () => {
  it("trimmar beskrivningen och slänger poster utan text", () => {
    const out = normalizeStandardAtgarder([
      atgard({ id: "a", description: "  Inledande åtgärder  " }),
      atgard({ id: "b", description: "   " }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("Inledande åtgärder");
  });

  it("dedupar på id — en redigerad post ERSÄTTER sin tidigare version", () => {
    const out = normalizeStandardAtgarder([
      atgard({ id: "inledande", minutes: 30 }),
      atgard({ id: "inledande", minutes: 45 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.minutes).toBe(45);
  });
});
