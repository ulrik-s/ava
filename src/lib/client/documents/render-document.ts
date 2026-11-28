"use client";

/**
 * `renderDocumentPdf` — dokumentmotorns ingång (ADR 0042):
 *
 *   Handlebars-mall + kontext → layoutmarkering → validerat layoutträd → PDF
 *
 * Allt sker i webbläsaren (offline), med pdf-lib via `PdfWriter`. Samma
 * indata ger samma layout. Huvudflödet ritas först; sidhuvud och sidfot ritas
 * sist på varje sida, när sidantalet är känt — de står i marginalerna, som
 * mallen själv dimensionerar.
 */

import type { PDFDocument, PDFFont, StandardFonts } from "pdf-lib";
import { PdfWriter, type PdfFonts } from "@/lib/client/kostnadsrakning/pdf-writer";
import type { BandPages, FontFamily, LayoutDocument, PageBand } from "@/lib/shared/documents/layout-ast";
import { buildLayout } from "@/lib/shared/documents/layout-build";
import { LayoutError } from "@/lib/shared/documents/markup-parser";
import { PAGE_COUNT_TOKEN, PAGE_NUMBER_TOKEN, type DocumentTemplateSource } from "@/lib/shared/documents/template-source";
import type { OrgImage } from "@/lib/shared/org-image";
import { compileDocumentMarkup } from "./compile-template";
import { FixedCursor, PageCursor, type DrawCtx } from "./draw-context";
import { drawFlow } from "./draw-flow";
import { toWinAnsi } from "./win-ansi";

/** Det ett dokument renderas ur. */
export interface RenderDocumentInput {
  source: DocumentTemplateSource;
  /** Mallens data — färdigformaterad (inga belopp räknas i mallen). */
  context: object;
  /** Bilderna mallen når med `<image src="namn">`; null = bilden saknas. */
  images: Readonly<Record<string, OrgImage | null>>;
}

type FontNames = Record<keyof Omit<PdfFonts, "sans">, keyof typeof StandardFonts>;

const FAMILIES: Readonly<Record<FontFamily, FontNames>> = {
  helvetica: { regular: "Helvetica", bold: "HelveticaBold", italic: "HelveticaOblique" },
  times: { regular: "TimesRoman", bold: "TimesRomanBold", italic: "TimesRomanItalic" },
};

async function embedFonts(pdf: PDFDocument, family: FontFamily, standard: typeof StandardFonts): Promise<PdfFonts> {
  const names = FAMILIES[family];
  const embed = (name: keyof typeof StandardFonts): Promise<PDFFont> => pdf.embedFont(standard[name]);
  const regular = await embed(names.regular);
  const bold = await embed(names.bold);
  const italic = await embed(names.italic);
  return { regular, bold, italic, sans: family === "helvetica" ? regular : await embed("Helvetica") };
}

/** Huvudflödets text: sidnummer hör hemma i sidhuvud/sidfot. */
function bodyText(raw: string): string {
  if (raw.includes(PAGE_NUMBER_TOKEN) || raw.includes(PAGE_COUNT_TOKEN)) {
    throw new LayoutError("{{pageNumber}} och {{pageCount}} får bara stå i <page-header> eller <page-footer>.");
  }
  return toWinAnsi(raw);
}

/** Sidhuvudets/sidfotens text med sidnumren insatta. */
function bandText(page: number, pages: number): (raw: string) => string {
  return (raw) => toWinAnsi(raw.replaceAll(PAGE_NUMBER_TOKEN, String(page)).replaceAll(PAGE_COUNT_TOKEN, String(pages)));
}

function onPage(pages: BandPages, index: number): boolean {
  if (pages === "first") return index === 0;
  return pages === "rest" ? index > 0 : true;
}

async function drawBands(ctx: DrawCtx, layout: LayoutDocument): Promise<void> {
  const bands: Array<[PageBand, string]> = [
    ...layout.headers.map((b): [PageBand, string] => [b, "<page-header>"]),
    ...layout.footers.map((b): [PageBand, string] => [b, "<page-footer>"]),
  ];
  const pages = ctx.writer.pages;
  for (const [index, page] of pages.entries()) {
    for (const [band, where] of bands.filter(([b]) => onPage(b.pages, index))) {
      const bandCtx: DrawCtx = { ...ctx, cursor: new FixedCursor(band.top, where), text: bandText(index + 1, pages.length) };
      await ctx.writer.withPage(page, () => drawFlow(bandCtx, band.children));
    }
  }
}

/** Rita ett validerat layoutträd till PDF-bytes. */
export async function drawLayoutPdf(layout: LayoutDocument, images: RenderDocumentInput["images"]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  if (layout.title) pdf.setTitle(layout.title);
  if (layout.subject) pdf.setSubject(layout.subject);
  const fonts = await embedFonts(pdf, layout.fontFamily, StandardFonts);
  const writer = new PdfWriter(pdf, fonts, rgb, { width: layout.width, height: layout.height });
  const { margins } = layout;
  const ctx: DrawCtx = {
    writer, images, text: bodyText,
    frame: { left: margins.left, width: layout.width - margins.left - margins.right },
    cursor: new PageCursor(writer, margins.top, layout.height - margins.bottom),
  };
  await drawFlow(ctx, layout.body);
  await drawBands(ctx, layout);
  return pdf.save();
}

/** Rendera en dokumentmall till PDF. Fel i mallen blir `LayoutError` med rad och element. */
export async function renderDocumentPdf(input: RenderDocumentInput): Promise<Uint8Array> {
  return drawLayoutPdf(buildLayout(compileDocumentMarkup(input.source, input.context)), input.images);
}
