/**
 * Byråns fakturamall (#2255; intag #149/#150/#151), ritad: brevhuvud med
 * fönsteradress, understruken betalningsuppmaning, uppgiftsblock,
 * dröjsmålsränta, avräkningstabell med Öresutjämning, summeringsruta på grå
 * botten med tjock linje och sidfoten med sigill på varje sida. Och sömmen:
 * en annan mall kan återanvända partialerna.
 */
import { describe, it, expect } from "vitest-compat";
import { renderFakturaPdf } from "@/lib/client/documents/faktura-pdf";
import { FAKTURA_BREV_TEMPLATE } from "@/lib/shared/documents/templates/faktura-brev";
import { FAKTURA_FIXTURES } from "../../../helpers/faktura-fixtures";
import { pdfDrawingOps, pdfPageLayouts, pdfPageTexts, type PdfPageLayout, type PdfTextItem } from "../../../helpers/pdf-text";

const fixture = (name: string) => FAKTURA_FIXTURES[name] ?? ((): never => { throw new Error(`fixturen ${name} saknas`); });

/** A4 och marginalerna 20 mm. */
const PAGE_HEIGHT = 841.89;
const MM = 72 / 25.4;
const LEFT = 20 * MM;
const RIGHT = 595.28 - 20 * MM;

const pdfY = (top: number): number => PAGE_HEIGHT - top;
const at = (page: PdfPageLayout | undefined, text: string, nth = 0): PdfTextItem | undefined => page?.texts.filter((t) => t.text === text)[nth];

async function width(text: string, font: "TimesRomanBold" | "TimesRoman", size: number): Promise<number> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  return (await (await PDFDocument.create()).embedFont(StandardFonts[font])).widthOfTextAtSize(text, size);
}

describe("byråns fakturamall — brevhuvudet (#149)", () => {
  it("mottagarens namn och postadress i fönsterkuvertets läge (110 mm in, 45 mm ned)", async () => {
    const [page] = await pdfPageLayouts(await renderFakturaPdf(fixture("aconto")()));
    const lines = ["Kalle Klientsson", "Exempelgatan 1", "123 45 Exempelstad"].map((t) => at(page, t));
    lines.forEach((l, i) => {
      expect(l?.x).toBeCloseTo(110 * MM, 3);
      expect(l?.y).toBeCloseTo(pdfY(45 * MM + i * 14), 3);
      expect(l?.size).toBe(11);
    });
  });

  it("FAKTURA NR i fetstil; \"endast fakturanummer\" — och bara det — är understruket", async () => {
    const [page] = await pdfPageLayouts(await renderFakturaPdf(fixture("slutfaktura")()));
    expect(at(page, "FAKTURA NR F-2026-0101")).toMatchObject({ font: "Times-Bold", size: 12, x: LEFT });
    const ask = at(page, "Ange endast fakturanummer vid betalning tack!");
    expect(ask).toMatchObject({ font: "Times-Bold", size: 12 });
    const underlines = (page?.lines ?? []).filter((l) => Math.abs(l.y - ((ask?.y ?? 0) - 12 * 0.12)) < 0.01);
    expect(underlines).toHaveLength(1);
    const start = LEFT + await width("Ange ", "TimesRomanBold", 12);
    expect(underlines[0]?.x1).toBeCloseTo(start, 3);
    expect(underlines[0]?.x2).toBeCloseTo(start + await width("endast fakturanummer", "TimesRomanBold", 12), 3);
  });

  it("uppgiftsblocket: etikett | värde, i ordning; dröjsmålsräntan i kursiv", async () => {
    const [page] = await pdfPageLayouts(await renderFakturaPdf(fixture("slutfaktura")()));
    const pairs: Array<[string, string]> = [
      ["Klient:", "Kalle Klientsson"], ["Fakturadag:", "2026-06-30"], ["Förfallodag:", "2026-07-30"],
      ["Vårt ärendenr:", "2026-0042"], ["Bankgiro:", "123-4567"],
    ];
    let previousY = Number.POSITIVE_INFINITY;
    for (const [label, value] of pairs) {
      const l = at(page, label);
      const v = page?.texts.find((t) => t.text === value && t.x > LEFT);
      expect(l?.x).toBeCloseTo(LEFT, 3);
      expect(v?.x).toBeCloseTo(LEFT + 100, 3);
      expect(v?.y).toBe(l?.y);
      expect(l?.y ?? 0).toBeLessThan(previousY);
      previousY = l?.y ?? 0;
    }
    expect(at(page, "Efter förfallodagen debiteras dröjsmålsränta enligt 6 § räntelagen")).toMatchObject({ font: "Times-Italic", size: 11 });
  });

  it("en kredit har ingen betalningsuppmaning, ingen förfallodag och ingen räntetext", async () => {
    const [texts = []] = await pdfPageTexts(await renderFakturaPdf(fixture("kredit")()));
    expect(texts).toContain("KREDITFAKTURA NR K-2026-0003");
    expect(texts.join("\n")).not.toMatch(/Ange endast|Förfallodag|dröjsmålsränta|Bankgiro:/);
  });
});

describe("byråns fakturamall — avräkningen och summeringen (#151)", () => {
  it("avräkningstabellen: Avräkning | Underlag | Andel | Belopp, med Öresutjämning så att raderna går på totalen", async () => {
    const [page] = await pdfPageLayouts(await renderFakturaPdf(fixture("aconto")()));
    const texts = page?.texts.map((t) => t.text) ?? [];
    const head = texts.indexOf("Avräkning");
    expect(texts.slice(head, head + 4)).toEqual(["Avräkning", "Underlag", "Andel", "Belopp"]);
    const share = at(page, "Klientens självrisk (exkl moms)");
    const onRow = (page?.texts ?? []).filter((t) => t.y === share?.y).map((t) => t.text);
    expect(onRow).toEqual(expect.arrayContaining(["11 998,40 kr", "20 %", "2 399,68 kr"]));
    const rounding = at(page, "Öresutjämning");
    const roundingAmount = page?.texts.find((t) => t.y === rounding?.y && t.text === "0,40 kr");
    expect(roundingAmount).toBeDefined();
    // Beloppen står högerjusterade mot innehållets högerkant.
    expect((roundingAmount?.x ?? 0) + await width("0,40 kr", "TimesRoman", 10.5)).toBeCloseTo(RIGHT, 3);
    expect(texts).toContain("Att betala (inkl moms)");
    expect(texts).not.toContain("Självrisk inkl utlägg (inkl moms)");
  });

  it("summeringsrutan: grå botten över hela bredden, inkl. moms i fetstil, tjock linje direkt under", async () => {
    const bytes = await renderFakturaPdf(fixture("aconto")());
    const [ops = []] = await pdfDrawingOps(bytes);
    const fills = ops.filter((o) => o.endsWith(" h f Q"));
    expect(fills).toHaveLength(3);
    for (const f of fills) {
      expect(f).toMatch(/^q 0\.9490196078431372 0\.9490196078431372 0\.9490196078431372 rg /);
      expect(f).toContain(`l ${RIGHT - LEFT} 18 l`);
    }
    const lastFillBottom = Number(/1 0 0 1 [\d.]+ ([\d.]+) cm/.exec(fills.at(-1) ?? "")?.[1]);
    const thick = ops.find((o) => o.includes(" 2.2 w "));
    expect(Number(/ ([\d.]+) m [\d.]+ [\d.]+ m/.exec(thick ?? "")?.[1])).toBeCloseTo(lastFillBottom, 6);
    const [page] = await pdfPageLayouts(bytes);
    expect(at(page, "Belopp exkl. moms")?.font).toBe("Times-Roman");
    expect(at(page, "Moms (25%)")).toBeDefined();
    expect(at(page, "Belopp inkl. moms")?.font).toBe("Times-Bold");
  });
});

describe("byråns fakturamall — sidfoten (#150)", () => {
  it("på varje sida: tunn linje, sigillet till vänster, byråns uppgifter centrerade i sans-serif", async () => {
    const bytes = await renderFakturaPdf(fixture("flersidig")());
    const pages = await pdfPageLayouts(bytes);
    const ops = await pdfDrawingOps(bytes);
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((page, i) => {
      const footer = page.texts.filter((t) => t.y < pdfY(772));
      expect(footer.map((t) => t.text)).toEqual([
        "Advokatfirman Exempel AB", "Tel: 08-123 456 78", "www.exempel.se",
        "Arvoden bankgiro 123-4567 · VAT nr: SE556677889901 · Godkänd för F-skatt",
      ]);
      for (const t of footer) expect(t).toMatchObject({ font: "Helvetica", size: 7.5 });
      expect(page.lines.some((l) => l.y === pdfY(772) && l.x1 === LEFT)).toBe(true);
      // Sigillet: 1 × 1 px inskalat i 80 × 42 → 42 × 42, överkant 780 pt, vid vänstermarginalen.
      expect(ops[i]?.some((o) => o.startsWith(`q 1 0 0 1 ${LEFT} ${pdfY(780) - 42} cm`) && o.endsWith("Do Q"))).toBe(true);
    });
  });

  it("utan byråns uppgifter står bara F-skatten kvar", async () => {
    const [page] = await pdfPageLayouts(await renderFakturaPdf(fixture("radgivning")()));
    expect(page?.texts.filter((t) => t.y < pdfY(772)).map((t) => t.text)).toEqual(["Godkänd för F-skatt"]);
  });
});

describe("renderFakturaPdf — mallen kan bytas", () => {
  it("en egen mall med samma vy-modell återanvänder partialerna", async () => {
    const template = `<document title="{{heading}}">{{> stilar}}{{> betalningsuppgifter}}<text>Att betala: {{total}}</text></document>`;
    const [page = []] = await pdfPageTexts(await renderFakturaPdf(fixture("slutfaktura")(), { ...FAKTURA_BREV_TEMPLATE, template }));
    expect(page.slice(0, 2)).toEqual(["FAKTURA NR F-2026-0101", "Ange endast fakturanummer vid betalning tack!"]);
    expect(page.at(-1)).toMatch(/^Att betala: /);
  });
});
