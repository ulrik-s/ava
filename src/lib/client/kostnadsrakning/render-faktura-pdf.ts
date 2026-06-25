"use client";

/**
 * `renderFakturaPdf` — bygger en enkel faktura-PDF client-side via pdf-lib.
 *
 * Används när en faktura skapas (t.ex. ur en kostnadsräknings dom) för att
 * lägga ett faktura-DOKUMENT i ärendets fil-lista, parallellt med Invoice-
 * entiteten. Layouten är medvetet enkel — beloppet kommer från domen/underlaget.
 */

import { formatCurrency } from "@/lib/client/utils";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/shared/vat";

export interface FakturaInput {
  invoice: {
    amount: number; // öre (brutto, inkl moms)
    /** Momsbelopp (öre) i `amount`, exakt per sats (#782). Saknas → 25 %-split. */
    vatOre?: number | null | undefined;
    invoiceNumber?: string | null | undefined;
    /** Bankgiro-OCR (#182). Null på kostnadsräkningar/CREDIT → raden utelämnas. */
    ocrReference?: string | null | undefined;
    invoiceDate?: string | Date | null | undefined;
  };
  meta: {
    matterNumber: string;
    matterTitle: string;
    clientName?: string;
    recipient?: string;
    organizationName?: string;
    organizationOrgNumber?: string;
  };
}

type LineFn = (text: string, opts?: { size?: number; b?: boolean; gap?: number; gray?: boolean }) => void;

/** Identitetsraderna under rubriken (fakturanr, datum, mottagare, klient). */
function drawIdentityLines(line: LineFn, input: FakturaInput): void {
  const date = input.invoice.invoiceDate ? new Date(input.invoice.invoiceDate).toLocaleDateString("sv-SE") : "";
  if (input.invoice.invoiceNumber) line(`Fakturanr: ${input.invoice.invoiceNumber}`);
  if (date) line(`Fakturadatum: ${date}`);
  if (input.meta.recipient) line(`Mottagare: ${input.meta.recipient}`);
  if (input.meta.clientName) line(`Klient: ${input.meta.clientName}`);
}

export async function renderFakturaPdf(input: FakturaInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Faktura ${input.meta.matterNumber}`);
  pdf.setSubject("Faktura");
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const M = 50;
  const RIGHT = 545;
  let y = 800;

  const line = (text: string, opts: { size?: number; b?: boolean; gap?: number; gray?: boolean } = {}): void => {
    page.drawText(text, {
      x: M, y, size: opts.size ?? 10, font: opts.b ? bold : font,
      color: opts.gray ? rgb(0.45, 0.45, 0.45) : rgb(0, 0, 0),
    });
    y -= opts.gap ?? 14;
  };

  line("FAKTURA", { size: 20, b: true, gap: 28 });
  if (input.meta.organizationName) line(input.meta.organizationName, { b: true });
  if (input.meta.organizationOrgNumber) line(`Org.nr ${input.meta.organizationOrgNumber}`, { size: 9 });
  y -= 8;
  line(`Mål ${input.meta.matterNumber} — ${input.meta.matterTitle}`, { size: 11, b: true, gap: 16 });
  drawIdentityLines(line, input);
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 22;
  // Moms-specifikation: netto + moms + att betala (brutto). Momsen är exakt per
  // sats när vatOre finns (#782), annars 25 %-split av bruttot.
  const bruttoOre = input.invoice.amount;
  const momsOre = input.invoice.vatOre != null
    ? input.invoice.vatOre
    : bruttoOre - splitVat({ amount: bruttoOre, vatRate: DEFAULT_VAT_RATE, vatIncluded: true }).exclVat;
  const amountRow = (label: string, ore: number, opts: { size?: number; b?: boolean } = {}): void => {
    page.drawText(label, { x: M, y, size: opts.size ?? 10, font: opts.b ? bold : font });
    page.drawText(formatCurrency(ore), { x: RIGHT - 130, y, size: opts.size ?? 10, font: opts.b ? bold : font });
    y -= opts.b ? 22 : 16;
  };
  amountRow("Belopp exkl. moms", bruttoOre - momsOre);
  amountRow("Moms", momsOre);
  amountRow("Att betala (inkl. moms)", bruttoOre, { size: 12, b: true });
  y -= 6;
  if (input.invoice.ocrReference) line(`OCR-referens: ${input.invoice.ocrReference}`, { size: 11, b: true, gap: 16 });
  line("Belopp enligt domstolens beslut / fakturaunderlag.", { size: 9, gray: true });

  return pdf.save();
}
