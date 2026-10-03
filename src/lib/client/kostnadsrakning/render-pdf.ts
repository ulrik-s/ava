"use client";

/**
 * `renderKostnadsrakningPdf` — bygger en PDF av en kostnadsräkning
 * client-side via pdf-lib.
 *
 * Tas av "Generera kostnadsräkning"-knappen i rättssalen — flödet är
 * stressigt så vi vill ha låg latens och inga server-anrop.
 *
 * Ritar dokumentvyn (`result.document`, #1218) — samma vy som HTML-mallen —
 * i byråns layout:
 *   Sida 1  — brevhuvud, mottagare, rubrik, referens, sammanställning, summor,
 *             ev. rådgivningsnotis, ort + datum, underskrift, sidfot. Inget sidnummer.
 *   Sida 2+ — ARBETSREDOGÖRELSE per kategori + utlägg; "Sida N" nederst.
 * Times (serif) som i byråns dokument; sidfoten i sans-serif.
 */

import type { PDFDocument, StandardFonts } from "pdf-lib";
import type { KostnadsrakningResult } from "@/lib/shared/kostnadsrakning";
import { FOOTER_SEPARATOR, type KrDocumentView } from "@/lib/shared/kostnadsrakning-document";
import type { KrExpenseSpec, KrSpecSection } from "@/lib/shared/kostnadsrakning-document-rows";
import { PAGE_WIDTH, PdfWriter, type PdfFonts } from "./pdf-writer";

export interface RenderInput {
  result: KostnadsrakningResult;
  meta: {
    matterNumber: string;
    matterTitle: string;
    clientName: string;
    courtName: string;
    defenderName: string;
    organizationName?: string;
    organizationOrgNumber?: string;
  };
}

/** Marginaler och kolumner (punkter), avlästa ur byråns kostnadsräkningar. */
const LEFT = 72;
const RIGHT = 533;
const QTY_RIGHT = 395;
const RECIPIENT_X = 365;
const SPEC_DATE_X = 77;
const SPEC_DESC_X = 168;
const SPEC_HOURS_RIGHT = 510;
const SPEC_SUM_RIGHT = 527;
const SPEC_TOP = 93;
const SPEC_BOTTOM = 770;
const SPEC_SIZE = 11;
const SPEC_LEADING = 12.6;

export async function renderKostnadsrakningPdf(input: RenderInput): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(`Kostnadsräkning ${input.meta.matterNumber}`);
  pdf.setAuthor(input.meta.defenderName);
  pdf.setSubject("Kostnadsräkning till rätten");
  const w = new PdfWriter(pdf, await embedFonts(pdf, lib.StandardFonts), lib.rgb);
  const doc = input.result.document;
  await drawFirstPage(w, doc);
  if (doc.hasSpecification) drawSpecification(w, doc);
  numberPages(w);
  return pdf.save();
}

async function embedFonts(pdf: PDFDocument, fonts: typeof StandardFonts): Promise<PdfFonts> {
  const [regular, bold, italic, sans] = await Promise.all([
    pdf.embedFont(fonts.TimesRoman), pdf.embedFont(fonts.TimesRomanBold),
    pdf.embedFont(fonts.TimesRomanItalic), pdf.embedFont(fonts.Helvetica),
  ]);
  return { regular, bold, italic, sans };
}

// ─── Sida 1 ────────────────────────────────────────────────────────────────

async function drawFirstPage(w: PdfWriter, doc: KrDocumentView): Promise<void> {
  await drawLetterhead(w, doc);
  if (doc.recipient) {
    w.text(doc.recipient, RECIPIENT_X, 160);
    w.text("via e-post", RECIPIENT_X, 174);
  }
  drawHeading(w, doc);
  let top = drawSummary(w, doc);
  top = drawNotes(w, doc.notes, top);
  top = drawRadgivning(w, doc.radgivningNotice, top);
  drawSignature(w, doc, top + 24);
  drawFooter(w, doc.footerLines);
  if (doc.footerSeal) await w.image(doc.footerSeal, { x: LEFT, top: 790, maxWidth: 80, maxHeight: 42, align: "left" });
}

/** Loggan centrerad överst — eller byråns namn när loggan saknas/inte går att läsa. */
async function drawLetterhead(w: PdfWriter, doc: KrDocumentView): Promise<void> {
  const drawn = doc.logo ? await w.image(doc.logo, { x: PAGE_WIDTH / 2, top: 38, maxWidth: 205, maxHeight: 95, align: "center" }) : false;
  if (!drawn && doc.firmName) w.text(doc.firmName, PAGE_WIDTH / 2, 95, { size: 18, align: "center" });
}

function drawHeading(w: PdfWriter, doc: KrDocumentView): void {
  w.text(doc.title, LEFT, 211, { font: "bold" });
  const label = w.text("Faktura-/ärendenr: ", LEFT, 229);
  w.text(`${doc.paymentReference} Anges vid betalning`, LEFT + label, 229, { font: "bold" });
  if (doc.bankgiro) w.text(`Bankgiro: ${doc.bankgiro}`, LEFT, 247);
}

/** Sammanställningen + summorna. Returnerar `top` under den tjocka linjen. */
function drawSummary(w: PdfWriter, doc: KrDocumentView): number {
  w.text("Enligt bifogad specifikation", LEFT, 289, { font: "italic", grey: true });
  w.text("tid/antal", QTY_RIGHT, 289, { font: "italic", grey: true, align: "right" });
  w.text("kr", RIGHT, 289, { font: "italic", grey: true, align: "right" });
  let top = 310;
  for (const row of doc.summaryRows) {
    w.text(row.label, LEFT, top);
    w.text(row.quantity, QTY_RIGHT, top, { align: "right" });
    w.text(row.amount, RIGHT, top, { align: "right" });
    top += 21.5;
  }
  top += 36;
  drawTotal(w, "Belopp exkl. moms", doc.totals.exclVat, top);
  drawTotal(w, doc.totals.vatLabel, doc.totals.vat, top + 35);
  drawTotal(w, "Belopp inkl. moms", doc.totals.inclVat, top + 53, "bold");
  w.rule(LEFT, RIGHT, top + 59, 2.2);
  return top + 59;
}

function drawTotal(w: PdfWriter, label: string, amount: string, top: number, font: "regular" | "bold" = "regular"): void {
  w.text(label, LEFT, top, { font });
  w.text(amount, RIGHT, top, { font, align: "right" });
}

/** Radbruten text i spaltbredd. Returnerar `top` efter sista raden. */
function drawParagraph(w: PdfWriter, text: string, top: number, size: number, leading: number): number {
  let t = top;
  for (const line of w.wrap(text, "regular", size, RIGHT - LEFT)) {
    w.text(line, LEFT, t, { size });
    t += leading;
  }
  return t;
}

function drawNotes(w: PdfWriter, notes: readonly string[], top: number): number {
  let t = top + (notes.length > 0 ? 16 : 0);
  for (const note of notes) t = drawParagraph(w, note, t, 10, 12);
  return t;
}

function drawRadgivning(w: PdfWriter, notice: string | null, top: number): number {
  return notice ? drawParagraph(w, notice, top + 20, 12, 14) : top;
}

function drawSignature(w: PdfWriter, doc: KrDocumentView, top: number): void {
  w.text(doc.placeDate, LEFT, top);
  w.text(doc.signatureName, LEFT, top + 30);
  if (doc.signatureTitle) w.text(doc.signatureTitle, LEFT, top + 44);
}

const FOOTER_SIZE = 8;

/** Sidfoten på sida 1: linje + centrerade rader, delarna åtskilda av en mittpunkt. */
function drawFooter(w: PdfWriter, lines: readonly string[][]): void {
  if (lines.length === 0) return;
  w.rule(LEFT, RIGHT, 782, 0.75, true);
  lines.forEach((parts, i) => drawFooterLine(w, parts, 805 + i * 10.5));
}

function drawFooterLine(w: PdfWriter, parts: readonly string[], top: number): void {
  w.text(parts.join(FOOTER_SEPARATOR), PAGE_WIDTH / 2, top, { font: "sans", size: FOOTER_SIZE, align: "center" });
}

// ─── Sida 2+: arbetsredogörelsen ───────────────────────────────────────────

/** Markör över sidbrytningar: ny sida när nästa block inte ryms. */
class SpecCursor {
  top = 168;
  constructor(private readonly w: PdfWriter) {}

  ensure(height: number): void {
    if (this.top + height <= SPEC_BOTTOM) return;
    this.w.addPage();
    this.top = SPEC_TOP;
  }
}

function drawSpecification(w: PdfWriter, doc: KrDocumentView): void {
  w.addPage();
  w.text("ARBETSREDOGÖRELSE", LEFT, SPEC_TOP, { font: "bold" });
  w.rule(LEFT, RIGHT, 116, 1);
  const c = new SpecCursor(w);
  for (const section of doc.specSections) drawTimeSection(w, c, section);
  if (doc.expenseSpec) drawExpenseSection(w, c, doc.expenseSpec);
}

function drawSectionHeading(w: PdfWriter, c: SpecCursor, heading: string): void {
  c.ensure(40);
  const width = w.text(heading, SPEC_DATE_X, c.top, { font: "bold", size: SPEC_SIZE });
  w.rule(SPEC_DATE_X, SPEC_DATE_X + width, c.top + 1.6, 0.6);
  c.top += 17;
}

/** En rad med radbruten beskrivning. `cells` ritas på första raden. */
function drawSpecRow(w: PdfWriter, c: SpecCursor, row: { date: string; lines: string[] }, cells: ReadonlyArray<[string, number]>): void {
  const height = row.lines.length * SPEC_LEADING;
  c.ensure(height);
  w.text(row.date, SPEC_DATE_X, c.top, { size: SPEC_SIZE });
  row.lines.forEach((line, i) => w.text(line, SPEC_DESC_X, c.top + i * SPEC_LEADING, { size: SPEC_SIZE }));
  for (const [text, right] of cells) w.text(text, right, c.top, { size: SPEC_SIZE, align: "right" });
  c.top += height + 2.5;
}

function drawSum(w: PdfWriter, c: SpecCursor, sum: string): void {
  c.ensure(SPEC_LEADING);
  w.text("Summa", LEFT, c.top, { font: "bold", size: SPEC_SIZE });
  w.text(sum, SPEC_SUM_RIGHT, c.top, { font: "bold", size: SPEC_SIZE, align: "right" });
  c.top += 48;
}

function drawTimeSection(w: PdfWriter, c: SpecCursor, section: KrSpecSection): void {
  drawSectionHeading(w, c, section.heading);
  for (const r of section.rows) {
    const lines = w.wrap(r.description, "regular", SPEC_SIZE, SPEC_HOURS_RIGHT - SPEC_DESC_X - 30);
    drawSpecRow(w, c, { date: r.date, lines }, [[r.quantity, SPEC_HOURS_RIGHT]]);
  }
  drawSum(w, c, section.sum);
}

const EXP_QTY_RIGHT = 445;
const EXP_PRICE_RIGHT = 485;

function drawExpenseSection(w: PdfWriter, c: SpecCursor, spec: KrExpenseSpec): void {
  drawSectionHeading(w, c, "Utlägg");
  for (const r of spec.rows) {
    const lines = w.wrap(r.description, "regular", SPEC_SIZE, EXP_QTY_RIGHT - SPEC_DESC_X - 30);
    drawSpecRow(w, c, { date: r.date, lines }, [[r.quantity, EXP_QTY_RIGHT], [r.unitPrice, EXP_PRICE_RIGHT], [r.amount, SPEC_SUM_RIGHT]]);
  }
  drawSum(w, c, spec.sum);
}

/** "Sida N" centrerat nederst på sida 2 och framåt — sida 1 får inget nummer. */
function numberPages(w: PdfWriter): void {
  w.pages.forEach((page, i) => {
    if (i === 0) return;
    w.textOn(page, `Sida ${i + 1}`, PAGE_WIDTH / 2, 802, { size: SPEC_SIZE, align: "center" });
  });
}
