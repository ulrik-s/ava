/**
 * Dokumentmotorns tillägg för byråns faktura (#2255, ADR 0042-tillägget):
 * understrykning (`<u>`), bakgrund på tabellrader (`fill`) och sans-serif
 * (`font="sans"`) — ritade av `PdfWriter`.
 */
import { describe, it, expect } from "vitest-compat";
import { renderDocumentPdf } from "@/lib/client/documents/render-document";
import { pdfDrawingOps, pdfPageLayouts, type PdfLineItem, type PdfTextItem } from "../../../helpers/pdf-text";

/** Ett 600 × 800 pt dokument, marginal 50 → innehållet 500 pt brett, baslinjerna 50–750. */
const PAGE = `width="600" height="800" margin="50"`;

const render = (body: string, attrs = PAGE): Promise<Uint8Array> =>
  renderDocumentPdf({ source: { template: `<document ${attrs}>${body}</document>`, partials: {} }, context: {}, images: {} });

async function layout(bytes: Uint8Array): Promise<{ texts: PdfTextItem[]; lines: PdfLineItem[] }> {
  const [page] = await pdfPageLayouts(bytes);
  return page ?? { texts: [], lines: [] };
}

async function helveticaWidth(text: string, size: number, bold = false): Promise<number> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const font = await (await PDFDocument.create()).embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  return font.widthOfTextAtSize(text, size);
}

describe("<u> — understrykning", () => {
  it("strecket ligger under exakt de understrukna tecknen, strax under baslinjen", async () => {
    const { texts, lines } = await layout(await render(`<text font="bold" size="10">Ange <u>endast fakturanummer</u> vid betalning tack!</text>`));
    expect(texts.map((t) => t.text)).toEqual(["Ange endast fakturanummer vid betalning tack!"]);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    const start = 50 + await helveticaWidth("Ange ", 10, true);
    expect(line?.x1).toBeCloseTo(start, 3);
    expect(line?.x2).toBeCloseTo(start + await helveticaWidth("endast fakturanummer", 10, true), 3);
    // Baslinjen 750 (pdf-y), strecket 0,12 × 10 pt under den.
    expect(line?.y).toBeCloseTo(750 - 1.2, 3);
  });

  it("tjockleken följer storleken (minst 0,5 pt) och färgen följer texten", async () => {
    const [ops = []] = await pdfDrawingOps(await render(`<text size="20" color="#ff0000"><u>X</u></text><text size="4"><u>Y</u></text>`));
    const strokes = ops.filter((o) => o.includes(" l S"));
    expect(strokes[0]).toMatch(/^q 1 0 0 RG 1\.2 w /);
    expect(strokes[1]).toMatch(/^q 0 0 0 RG 0\.5 w /);
  });

  it("radbryts: varje rad får sitt eget streck; centrerad text stryks under där den står", async () => {
    const words = Array.from({ length: 30 }, (_, i) => `ord${i}`).join(" ");
    const { texts, lines } = await layout(await render(`<text align="center">Före <u>${words}</u></text>`));
    expect(texts.length).toBeGreaterThan(1);
    expect(lines).toHaveLength(texts.length);
    const [first, second] = texts;
    const [firstLine, secondLine] = lines;
    // Första raden: strecket börjar efter "Före " och slutar i radens högerkant.
    expect(firstLine?.x1).toBeCloseTo((first?.x ?? 0) + await helveticaWidth("Före ", 10), 3);
    expect(firstLine?.x2).toBeCloseTo((first?.x ?? 0) + await helveticaWidth(first?.text ?? "", 10), 3);
    // Andra raden är helt understruken, från sin (centrerade) vänsterkant.
    expect(secondLine?.x1).toBeCloseTo(second?.x ?? 0, 3);
    expect(secondLine?.x2).toBeCloseTo((second?.x ?? 0) + await helveticaWidth(second?.text ?? "", 10), 3);
  });

  it("högerjusterad text; ingen understrykning ritar inga streck", async () => {
    const right = await layout(await render(`<text align="right">a <u>b</u></text>`));
    expect(right.lines[0]?.x2).toBeCloseTo(550, 3);
    expect(right.lines[0]?.x1).toBeCloseTo(550 - await helveticaWidth("b", 10), 3);
    expect((await layout(await render(`<text>utan streck</text>`))).lines).toEqual([]);
  });
});

describe("fill — bakgrund på tabellrader", () => {
  it("rektangeln täcker tabellens bredd och radens höjd, ritad före texten", async () => {
    const [ops = []] = await pdfDrawingOps(await render(`<table fill="0.9" leading="20"><col width="100"/><col width="60" align="right"/><row space-after="4"><cell>A</cell><cell>1</cell></row></table>`));
    // 160 pt bred (kolumnerna), 20 + 4 pt hög; överkanten 0,72 × 20 = 14,4 pt över
    // baslinjen 50 → nederkanten 50 − 14,4 + 24 = 59,6 pt från överkanten = pdf-y 740,4.
    expect(ops[0]).toBe("q 0.9 0.9 0.9 rg 0 w [] 0 d 1 0 0 1 50 740.4 cm 1 0 0 1 0 0 cm 1 0 0 1 0 0 cm 0 0 m 0 24 l 160 24 l 160 0 l h f Q");
    expect(ops.slice(1).every((o) => o.includes("Tj"))).toBe(true);
  });

  it("fyllda rader i följd möts utan glipa", async () => {
    const [ops = []] = await pdfDrawingOps(await render(`<table leading="15"><col width="*"/><row fill="0.9"><cell>a</cell></row><row fill="0.9"><cell>b</cell></row></table>`));
    const tops = ops.filter((o) => o.endsWith(" h f Q")).map((o) => Number(/1 0 0 1 50 ([\d.]+) cm/.exec(o)?.[1]));
    expect(tops).toHaveLength(2);
    expect((tops[0] ?? 0) - (tops[1] ?? 0)).toBeCloseTo(15, 6);
  });
});

describe("font=\"sans\"", () => {
  it("Helvetica i ett Times-dokument", async () => {
    const { texts } = await layout(await render(`<style name="sidfot" font="sans" size="8"/><text style="sidfot">Sidfot</text><text>Brödtext</text>`, `${PAGE} font-family="times"`));
    expect(texts.map((t) => [t.text, t.font, t.size])).toEqual([["Sidfot", "Helvetica", 8], ["Brödtext", "Times-Roman", 10]]);
  });
});
