/**
 * `renderDocumentPdf` (#2251, ADR 0042): layoutträdet ritas av `PdfWriter` —
 * flödet med sidbrytningar, sidhuvud/sidfot med sidnummer, upprepade
 * tabellrubriker, positionerade block och namngivna bilder.
 */
import { describe, it, expect } from "vitest-compat";
import { renderDocumentPdf } from "@/lib/client/documents/render-document";
import { LayoutError } from "@/lib/shared/documents/markup-parser";
import { orgImageSchema, type OrgImage } from "@/lib/shared/org-image";
import { pdfDrawingOps, pdfPageLayouts, pdfPageTexts, type PdfTextItem } from "../../../helpers/pdf-text";

/** 1×1 px PNG. */
const PNG_LOGO = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

/** Ett 600 × 800 pt dokument, marginal 50 → innehållet 500 pt brett, baslinjerna 50–750. */
const PAGE = `width="600" height="800" margin="50"`;

const render = (template: string, context: object = {}, images: Record<string, OrgImage | null> = {}): Promise<Uint8Array> =>
  renderDocumentPdf({ source: { template, partials: {} }, context, images });

const docOf = (body: string, attrs = PAGE): string => `<document ${attrs}>${body}</document>`;

async function texts(bytes: Uint8Array): Promise<PdfTextItem[][]> {
  return (await pdfPageLayouts(bytes)).map((p) => p.texts);
}

const find = (runs: readonly PdfTextItem[] | undefined, text: string): PdfTextItem | undefined => runs?.find((r) => r.text === text);

describe("renderDocumentPdf — flödet", () => {
  it("text på baslinjen från marginalen, justerad vänster/mitten/höger, i dokumentets storlek", async () => {
    const bytes = await render(docOf(`<text leading="20">V</text><text align="center" leading="20">M</text><text align="right">H</text>`));
    const [page = []] = await texts(bytes);
    // y i pdf-koordinater (nedifrån): 800 − 50 = 750, sedan 20 pt per rad.
    expect(find(page, "V")).toMatchObject({ x: 50, y: 750, size: 10, font: "Helvetica" });
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    expect(find(page, "M")?.x).toBeCloseTo(300 - font.widthOfTextAtSize("M", 10) / 2, 3);
    expect(find(page, "M")?.y).toBe(730);
    expect(find(page, "H")?.x).toBeCloseTo(550 - font.widthOfTextAtSize("H", 10), 3);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(loaded.getTitle()).toBeUndefined();
  });

  it("titel och ämne ur <document>", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const loaded = await PDFDocument.load(await render(docOf("", `${PAGE} title="Faktura {{nr}}" subject="Faktura"`), { nr: "F-1" }));
    expect(loaded.getTitle()).toBe("Faktura F-1");
    expect(loaded.getSubject()).toBe("Faktura");
  });

  it("långa stycken radbryts och fortsätter på nästa sida", async () => {
    const words = Array.from({ length: 1500 }, (_, i) => `ord${i}`).join(" ");
    const pages = await pdfPageTexts(await render(docOf(`<text leading="12">${words}</text>`)));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().join(" ")).toBe(words);
  });

  it("keep bryter sidan före elementet; spacer och space-before/after flyttar markören", async () => {
    const pages = await texts(await render(docOf(`<spacer height="660"/><text keep="50" space-before="5">Ny sida</text><text space-before="-2" space-after="3">Efter</text><text>Sist</text>`)));
    expect(pages).toHaveLength(2);
    expect(find(pages[1], "Ny sida")?.y).toBe(745);
    expect(find(pages[1], "Efter")?.y).toBe(745 - 14 + 2);
    expect(find(pages[1], "Sist")?.y).toBe(745 - 14 + 2 - 14 - 3);
  });

  it("page-break ger en ny sida; Times som familj", async () => {
    const bytes = await render(docOf(`<text font="bold">A</text><page-break/><text font="italic">B</text>`, `${PAGE} font-family="times"`));
    const [p1 = [], p2 = []] = await texts(bytes);
    expect(find(p1, "A")?.font).toBe("Times-Bold");
    expect(find(p2, "B")).toMatchObject({ font: "Times-Italic", y: 750 });
  });

  it("rule över ramens bredd med tjocklek och färg", async () => {
    const [ops = []] = await pdfDrawingOps(await render(docOf(`<rule thickness="2" color="0.5" space-before="10"/>`)));
    expect(ops).toEqual(["q 0.5 0.5 0.5 RG 2 w [] 0 d 50 740 m 50 740 m 550 740 l S Q"]);
  });
});

describe("renderDocumentPdf — block och bilder", () => {
  it("ett block ritas på sin plats utan att flytta huvudflödet", async () => {
    const [page = []] = await texts(await render(docOf(`<block x="300" top="100" width="200"><text align="right">Adress</text></block><text>Kropp</text>`)));
    expect(find(page, "Kropp")).toMatchObject({ x: 50, y: 750 });
    expect(find(page, "Adress")?.y).toBe(700);
  });

  it("<page-break/> i ett block är ett fel", async () => {
    await expect(render(docOf(`<block x="0" top="0"><page-break/></block>`))).rejects.toThrow(/<page-break\/> kan inte stå i <block>/);
  });

  it("en namngiven bild skalas in i rutan, högerställd; den tar sin höjd i flödet", async () => {
    const bytes = await render(docOf(`<image src="logo" width="40" height="20" align="right" space-after="5"/><text>Under</text>`), {}, { logo: PNG_LOGO });
    const [ops = []] = await pdfDrawingOps(bytes);
    // 1×1 px skalad till 20 × 20, högerkant 550, överkant 50 → nederkant 800 − 50 − 20.
    expect(ops[0]).toBe("q 1 0 0 1 530 730 cm 1 0 0 1 0 0 cm 20 0 0 20 0 0 cm 1 0 0 1 0 0 cm /Image Do Q");
    expect(find((await texts(bytes))[0], "Under")?.y).toBe(750 - 25);
  });

  it("centrerad och vänsterställd bild", async () => {
    const [ops = []] = await pdfDrawingOps(await render(docOf(`<image src="a" width="10" height="10" align="center"/><image src="a" width="10" height="10"/>`), {}, { a: PNG_LOGO }));
    expect(ops[0]).toContain("1 0 0 1 295 740 cm");
    expect(ops[1]).toContain("1 0 0 1 50 730 cm");
  });

  it("en bild som saknas (null) eller inte går att bädda in ritas inte och tar ingen plats", async () => {
    const broken = orgImageSchema.parse("data:image/png;base64,AAAA");
    const bytes = await render(docOf(`<image src="a" width="10" height="10"/><image src="b" width="10" height="10"/><text>T</text>`), {}, { a: null, b: broken });
    const [ops = []] = await pdfDrawingOps(bytes);
    expect(ops.some((o) => o.includes(" Do "))).toBe(false);
    expect(find((await texts(bytes))[0], "T")?.y).toBe(750);
  });

  it("en okänd bild är ett fel som listar de kända", async () => {
    await expect(render(docOf(`<image src="sigill" width="1" height="1"/>`), {}, { logo: null })).rejects.toThrow(/<image src="sigill">: ingen bild med det namnet \(finns: logo\)/);
    await expect(render(docOf(`<image src="sigill" width="1" height="1"/>`))).rejects.toThrow(/finns: inga/);
  });
});

describe("renderDocumentPdf — sidhuvud och sidfot", () => {
  const BANDS = `
    <page-header top="30" pages="first"><text>Brevhuvud</text></page-header>
    <page-header top="30" pages="rest"><text>Fortsättning</text></page-header>
    <page-footer top="780"><text align="center">Sida {{pageNumber}} av {{pageCount}}</text></page-footer>
    <text>Ett</text><page-break/><text>Två</text><page-break/><text>Tre</text>`;

  it("ritas på varje sida enligt pages, med sidnummer och sidantal", async () => {
    const pages = await pdfPageTexts(await render(docOf(BANDS)));
    expect(pages).toEqual([
      ["Ett", "Brevhuvud", "Sida 1 av 3"],
      ["Två", "Fortsättning", "Sida 2 av 3"],
      ["Tre", "Fortsättning", "Sida 3 av 3"],
    ]);
  });

  it("sidhuvudet står på sin egen markör (top)", async () => {
    const [page = []] = await texts(await render(docOf(BANDS)));
    expect(find(page, "Brevhuvud")?.y).toBe(770);
    expect(find(page, "Sida 1 av 3")?.y).toBe(20);
  });

  it("sidnummer i huvudflödet är ett fel", async () => {
    await expect(render(docOf("<text>Sida {{pageNumber}}</text>"))).rejects.toThrow(LayoutError);
    await expect(render(docOf("<text>{{pageCount}}</text>"))).rejects.toThrow(/får bara stå i <page-header> eller <page-footer>/);
  });

  it("<page-break/> i en sidfot är ett fel", async () => {
    await expect(render(docOf(`<page-footer top="1"><page-break/></page-footer><text>x</text>`))).rejects.toThrow(/kan inte stå i <page-footer>/);
  });
});

describe("renderDocumentPdf — tabeller", () => {
  const rows = (n: number): string => Array.from({ length: n }, (_, i) => `<row><cell>Rad ${i}</cell><cell>${i} kr</cell></row>`).join("");
  const table = (attrs: string, n: number): string => docOf(`
    <table ${attrs}>
      <col width="*" wrap="true"/><col width="100" align="right"/>
      <thead keep="40"><row font="bold" leading="18"><cell>Text</cell><cell>Belopp</cell></row></thead>
      ${rows(n)}
      <tfoot keep="30"><rule/><row font="bold"><cell>Summa</cell><cell>Allt</cell></row></tfoot>
    </table>`);

  it("rubriken upprepas överst när kroppen bryter sidan", async () => {
    const pages = await pdfPageTexts(await render(table("", 60)));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page[0]).toBe("Text");
    expect(pages.at(-1)?.slice(-2)).toEqual(["Summa", "Allt"]);
  });

  it("repeat-header=\"false\": rubriken bara en gång", async () => {
    const pages = await pdfPageTexts(await render(table(`repeat-header="false"`, 60)));
    expect(pages.flat().filter((t) => t === "Text")).toHaveLength(1);
  });

  it("en linje i kroppen som bryter sidan ger också rubriken igen", async () => {
    const pages = await pdfPageTexts(await render(docOf(`<spacer height="650"/>
      <table><col width="*"/><thead><row><cell>Rubrik</cell></row></thead><rule keep="200"/><row><cell>Efter</cell></row></table>`)));
    expect(pages[1]).toEqual(["Rubrik", "Efter"]);
  });

  it("kroppsrader radbryter wrap-kolumnen; enradiga celler ritas först, på radens första baslinje", async () => {
    const long = Array.from({ length: 30 }, (_, i) => `ord${i}`).join(" ");
    const [page = []] = await texts(await render(docOf(`
      <table><col width="200" wrap="true"/><col width="*" align="right"/>
        <row leading="12"><cell>${long}</cell><cell>99 kr</cell></row><row><cell>Nästa</cell><cell/></row>
      </table>`)));
    expect(page[0]).toMatchObject({ text: "99 kr", y: 750 });
    expect(page[1]).toMatchObject({ text: page[1]?.text, x: 50, y: 750 });
    const lines = page.filter((t) => t.text.startsWith("ord"));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.text).join(" ")).toBe(long);
    expect(find(page, "Nästa")?.y).toBe(750 - lines.length * 12);
  });
});
