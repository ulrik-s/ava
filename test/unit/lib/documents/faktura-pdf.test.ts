/**
 * `renderFakturaPdf` (#2251): fakturan ur standardmallen — eller ur en annan
 * mall (sömmen för byråns egna mallar i fas 2). Visar också hur de delade
 * partialerna bygger ett nytt dokument: `{{> sidfot}}` ger sidfot med sidnummer.
 */
import { describe, it, expect } from "vitest-compat";
import { renderFakturaPdf } from "@/lib/client/documents/faktura-pdf";
import { STANDARD_FAKTURA_TEMPLATE } from "@/lib/shared/documents/templates/faktura";
import { FAKTURA_FIXTURES } from "../../../helpers/faktura-fixtures";
import { pdfPageLayouts, pdfPageTexts } from "../../../helpers/pdf-text";

const slutfaktura = FAKTURA_FIXTURES.slutfaktura ?? ((): never => { throw new Error("fixturen saknas"); });

describe("renderFakturaPdf — mallen kan bytas", () => {
  it("standardmallen + sidfoten: byrå, org.nr och \"Sida x av y\" längst ned på varje sida", async () => {
    const source = { ...STANDARD_FAKTURA_TEMPLATE, template: STANDARD_FAKTURA_TEMPLATE.template.replace("</document>", "{{> sidfot}}</document>") };
    const pages = await pdfPageLayouts(await renderFakturaPdf(slutfaktura(), source));
    expect(pages).toHaveLength(2);
    pages.forEach((page, i) => {
      const footer = page.texts.find((t) => t.text.includes("Sida"));
      expect(footer?.text).toBe(`Advokatfirman Exempel AB · Org.nr 556677-8899 · Sida ${i + 1} av 2`);
      expect(footer?.y).toBe(842 - 815);
    });
  });

  it("en egen mall med samma vy-modell: brevhuvud och betalningsuppgifter återanvänds", async () => {
    const template = `<document title="{{heading}}">{{> stilar}}{{> brevhuvud rubrik="Påminnelse"}}{{> betalningsuppgifter}}<text>Att betala: {{total}}</text></document>`;
    const [page = []] = await pdfPageTexts(await renderFakturaPdf(slutfaktura(), { ...STANDARD_FAKTURA_TEMPLATE, template }));
    expect(page).toEqual([
      "PÅMINNELSE", "Advokatfirman Exempel AB", "Org.nr 556677-8899",
      "Fakturanr: F-2026-0101", "Fakturadatum: 2026-06-30", "Mottagare: Klient AB", "OCR-referens: 202601014",
      expect.stringMatching(/^Att betala: /),
    ]);
  });
});
