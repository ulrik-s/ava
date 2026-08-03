/**
 * Byråns standardåtgärder (#956) — urvalslogiken. Poängen med hela funktionen är
 * att ALLA på byrån ser samma lista i samma ordning; går urvalet isär mellan
 * jurister får kostnadsräkningarna olika ordalydelse för samma åtgärd, vilket är
 * precis det problem åtgärderna ska lösa.
 */
import { describe, it, expect } from "vitest-compat";
import {
  applicableStandardAtgarder, normalizeStandardAtgarder, suggestedStandardAtgarder,
  type StandardAtgard, type StandardAtgardContext,
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

/**
 * Vilka åtgärder som FÖRESLÅS (#958). Poängen är att just de här åtgärderna glöms:
 * "Avslutande åtgärder inklusive mottagande av dom" registreras i praktiken när
 * ärendet redan känns färdigt. Förslaget måste därför komma vid rätt tidpunkt —
 * och sluta komma när det inte längre är meningsfullt.
 */
describe("suggestedStandardAtgarder", () => {
  const LIST = [
    atgard({ id: "start", stage: "OPENING", description: "Inledande åtgärder" }),
    atgard({ id: "slut", stage: "CLOSING", description: "Avslutande åtgärder" }),
    atgard({ id: "lopande", stage: "ANY", description: "Löpande åtgärd" }),
  ];
  const ctx = (over: Partial<StandardAtgardContext> = {}): StandardAtgardContext => ({
    hasTimeEntries: true, verdictRegistered: false, matterClosed: false, settled: false,
    registeredIds: new Set(), ...over,
  });

  it("nytt ärende utan tidsposter → inledande åtgärder föreslås", () => {
    const out = suggestedStandardAtgarder(LIST, "RATTSHJALP", ctx({ hasTimeEntries: false }));
    expect(out.map((a) => a.id)).toEqual(["start"]);
  });

  it("registrerad dom → avslutande åtgärder föreslås", () => {
    const out = suggestedStandardAtgarder(LIST, "RATTSHJALP", ctx({ verdictRegistered: true }));
    expect(out.map((a) => a.id)).toEqual(["slut"]);
  });

  it("stängt ärende → avslutande åtgärder även UTAN kostnadsräkning (rättsskydd/privat)", () => {
    const out = suggestedStandardAtgarder(LIST, "RATTSSKYDD", ctx({ matterClosed: true }));
    expect(out.map((a) => a.id)).toEqual(["slut"]);
  });

  it("pågående ärende mitt i arbetet → inga förslag (ingen permanent uppmaning)", () => {
    expect(suggestedStandardAtgarder(LIST, "PRIVAT", ctx())).toEqual([]);
  });

  it("ANY-åtgärder föreslås ALDRIG — de skulle ligga kvar för alltid", () => {
    const out = suggestedStandardAtgarder(LIST, "PRIVAT", ctx({ hasTimeEntries: false, verdictRegistered: true }));
    expect(out.map((a) => a.id)).toEqual(["start", "slut"]);
    expect(out.map((a) => a.id)).not.toContain("lopande");
  });

  it("redan registrerad åtgärd föreslås inte igen", () => {
    const out = suggestedStandardAtgarder(LIST, "RATTSHJALP",
      ctx({ verdictRegistered: true, registeredIds: new Set(["slut"]) }));
    expect(out).toEqual([]);
  });

  it("slutreglerat ärende ger INGA förslag — arbetet är fryst och når inte fakturan", () => {
    // Utan den här spärren skulle vi föreslå en åtgärd som inte kan faktureras.
    const out = suggestedStandardAtgarder(LIST, "RATTSHJALP",
      ctx({ verdictRegistered: true, matterClosed: true, hasTimeEntries: false, settled: true }));
    expect(out).toEqual([]);
  });

  it("betalningssätts-begränsning gäller även i förslagen", () => {
    const list = [atgard({ id: "bara-rh", stage: "CLOSING", paymentMethods: ["RATTSHJALP"] })];
    expect(suggestedStandardAtgarder(list, "RATTSHJALP", ctx({ verdictRegistered: true })).map((a) => a.id)).toEqual(["bara-rh"]);
    expect(suggestedStandardAtgarder(list, "PRIVAT", ctx({ verdictRegistered: true }))).toEqual([]);
  });

  it("byrå utan standardåtgärder får inga förslag", () => {
    expect(suggestedStandardAtgarder([], "RATTSHJALP", ctx({ hasTimeEntries: false }))).toEqual([]);
    expect(suggestedStandardAtgarder(undefined, "RATTSHJALP", ctx({ hasTimeEntries: false }))).toEqual([]);
  });
});
