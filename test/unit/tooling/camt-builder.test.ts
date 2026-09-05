import { describe, it, expect } from "vitest-compat";
import { parseCamtXml } from "@/lib/shared/payments/camt-parse";
import { buildCamt054 } from "../../../tooling/scripts/camt-builder";

/**
 * Generatorn (#1067) är bara värd något om den RIKTIGA parsern läser den, och
 * läser den rätt. Testet kör därför alltid `buildCamt054` → `parseCamtXml` —
 * aldrig en påhittad mellanform.
 *
 * Det fångar också driften åt andra hållet: ändrar någon parsern så den slutar
 * förstå SEB:s struktur failar det här innan en byrå upptäcker det genom att
 * en importerad fil inte bokförs.
 */
const OPTS = { bookingDate: "2026-06-15" };

describe("buildCamt054 → parseCamtXml", () => {
  it("rundgår en enkel inbetalning", () => {
    const xml = buildCamt054([{
      reference: "REF-1", amountOre: 12_500, debtorName: "Klient AB",
      structuredRefs: [{ ref: "1234567890" }],
    }], OPTS);
    const file = parseCamtXml(xml);
    expect(file.transactions).toHaveLength(1);
    const [tx] = file.transactions;
    expect(tx?.amountOre).toBe(12_500);
    expect(tx?.currency).toBe("SEK");
    expect(tx?.creditDebit).toBe("CRDT");
    expect(tx?.debtorName).toBe("Klient AB");
    expect(tx?.valueDate).toBe("2026-06-15");
  });

  it("bär strukturerad OCR-referens", () => {
    const xml = buildCamt054([{
      reference: "REF-2", amountOre: 50_000, debtorName: "K",
      structuredRefs: [{ ref: "9988776655" }],
    }], OPTS);
    const [tx] = parseCamtXml(xml).transactions;
    expect(tx?.structuredRefs.map((r) => r.ref)).toEqual(["9988776655"]);
  });

  // En TxDtls kan betala flera fakturor med var sitt delbelopp — det är så
  // bankgirot itemiserar en samlad insättning.
  it("bär delbelopp per referens vid samlad betalning", () => {
    const xml = buildCamt054([{
      reference: "REF-3", amountOre: 30_000, debtorName: "K",
      structuredRefs: [{ ref: "A1", amountOre: 10_000 }, { ref: "A2", amountOre: 20_000 }],
    }], OPTS);
    const [tx] = parseCamtXml(xml).transactions;
    expect(tx?.structuredRefs).toEqual([
      { ref: "A1", amountOre: 10_000 },
      { ref: "A2", amountOre: 20_000 },
    ]);
  });

  it("bär fri text — domstolsbetalningarnas väg", () => {
    const xml = buildCamt054([{
      reference: "REF-4", amountOre: 1_626_000, debtorName: "DOMSTOLSVERKET",
      freeTexts: ["1154602 3288-26 ENOKSSON"],
    }], OPTS);
    const [tx] = parseCamtXml(xml).transactions;
    expect(tx?.freeTexts).toEqual(["1154602 3288-26 ENOKSSON"]);
  });

  it("bygger flera kontohändelser i samma fil", () => {
    const xml = buildCamt054([
      { reference: "R1", amountOre: 100, debtorName: "A", freeTexts: ["x"] },
      { reference: "R2", amountOre: 200, debtorName: "B", freeTexts: ["y"] },
    ], OPTS);
    expect(parseCamtXml(xml).transactions).toHaveLength(2);
  });

  // Öre → kronor sker bara i generatorn; ett avrundningsfel här skulle bokföra
  // fel belopp utan att något annat märker det.
  it("konverterar öre till kronor utan att tappa ören", () => {
    const xml = buildCamt054([{
      reference: "R", amountOre: 4_065_00, debtorName: "K", freeTexts: ["x"],
    }], OPTS);
    expect(xml).toContain('<Amt Ccy="SEK">4065.00</Amt>');
    expect(parseCamtXml(xml).transactions[0]?.amountOre).toBe(4_065_00);
  });

  it("escapar tecken som annars spräcker filen", () => {
    const xml = buildCamt054([{
      reference: "R", amountOre: 100, debtorName: "Bolag & Söner <AB>",
      freeTexts: ["a & b"],
    }], OPTS);
    expect(() => parseCamtXml(xml)).not.toThrow();
    expect(parseCamtXml(xml).transactions[0]?.debtorName).toBe("Bolag & Söner <AB>");
  });

  it("summerar filens totalbelopp i TxsSummry", () => {
    const xml = buildCamt054([
      { reference: "R1", amountOre: 10_000, debtorName: "A", freeTexts: ["x"] },
      { reference: "R2", amountOre: 15_000, debtorName: "B", freeTexts: ["y"] },
    ], OPTS);
    expect(xml).toContain("<NbOfNtries>2</NbOfNtries>");
    expect(xml).toContain("<Sum>250.00</Sum>");
  });

  it("använder camt.054-namnrymden banken skickar", () => {
    const xml = buildCamt054([{ reference: "R", amountOre: 1, debtorName: "A", freeTexts: ["x"] }], OPTS);
    expect(xml).toContain("urn:iso:std:iso:20022:tech:xsd:camt.054.001.02");
  });
});
