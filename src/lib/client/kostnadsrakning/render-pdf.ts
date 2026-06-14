"use client";

/**
 * `renderKostnadsrakningPdf` — bygger en PDF av en kostnadsräkning
 * client-side via pdf-lib.
 *
 * Tas av "Generera kostnadsräkning"-knappen i rättssalen — flödet är
 * stressigt så vi vill ha låg latens och inga server-anrop. pdf-lib
 * är ~500 KB gzipped, redan installerad för seed-binärerna.
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │  KOSTNADSRÄKNING                            │
 *   │  Mål 2026-0016 — Brottmål, Falk             │
 *   │  Stockholms tingsrätt           2026-05-25  │
 *   │                                              │
 *   │  ─ Huvudförhandling ─                       │
 *   │  Start: 09:00  Slut: 10:35  (1 tim 35 min)  │
 *   │                                              │
 *   │  ─ Arvode (DVFS 2025:6, nivå 1) ─           │
 *   │  Brottmålstaxa            5 635,00 kr exkl  │
 *   │  + Moms 25 %              1 408,75 kr       │
 *   │                          --------           │
 *   │                           7 043,75 kr inkl  │
 *   │                                              │
 *   │  ─ Utlägg ─                                 │
 *   │  Datum  Beskr.  Exkl  Moms  Inkl            │
 *   │  ... rader ...                              │
 *   │  Summa utlägg: X / Y / Z kr                 │
 *   │                                              │
 *   │  ─ TOTALT ATT FAKTURERA STATEN ─            │
 *   │  Z kr                                       │
 *   │                                              │
 *   │  Anna Advokat · Firma AB · 556999-9999      │
 *   └────────────────────────────────────────────┘
 */

import type { PDFPage, PDFFont, RGB } from "pdf-lib";
import type { KostnadsrakningResult } from "@/lib/shared/kostnadsrakning";

/** En formaterad utläggsrad i templateContext.expenseLines (se
 *  kostnadsrakning.ts buildTemplateContext) — alla fält är required strings. */
interface ExpenseRow {
  date: string;
  description: string;
  vatRateLabel: string;
  exclVatFormatted: string;
  vatFormatted: string;
  inclVatFormatted: string;
}

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

export async function renderKostnadsrakningPdf(input: RenderInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const c = input.result.templateContext;
  pdf.setTitle(`Kostnadsräkning ${input.meta.matterNumber}`);
  pdf.setAuthor(input.meta.defenderName);
  pdf.setSubject("Kostnadsräkning till rätten");

  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const MARGIN = 50;
  let y = 800;

  // Header
  page.drawText("KOSTNADSRÄKNING", {
    x: MARGIN, y, size: 20, font: bold, color: rgb(0, 0, 0),
  });
  y -= 28;
  page.drawText(`Mål ${input.meta.matterNumber} — ${input.meta.matterTitle}`, {
    x: MARGIN, y, size: 12, font: bold,
  });
  y -= 16;
  if (input.meta.clientName) {
    page.drawText(`Klient: ${input.meta.clientName}`, { x: MARGIN, y, size: 10, font });
  }
  page.drawText(`Datum: ${String(c.today)}`, {
    x: PAGE_W - MARGIN - 100, y, size: 10, font,
  });
  y -= 14;
  if (input.meta.courtName) {
    page.drawText(`Domstol: ${input.meta.courtName}`, { x: MARGIN, y, size: 10, font });
    y -= 14;
  }
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 18;

  // Huvudförhandling
  page.drawText("Huvudförhandling", { x: MARGIN, y, size: 11, font: bold });
  y -= 14;
  page.drawText(
    `Start: ${String(c.hufStart)}   Slut: ${String(c.hufEnd)}   (${String(c.huvudforhandlingFormatted)})`,
    { x: MARGIN, y, size: 10, font },
  );
  y -= 22;

  // Arvode
  page.drawText(`Arvode (DVFS 2025:6, nivå ${String(c.taxaLevel)})`, {
    x: MARGIN, y, size: 11, font: bold,
  });
  y -= 14;
  if (c.taxaApplies) {
    drawRow(page, y, font, "Brottmålstaxa", String(c.arvodeExclFormatted));
    y -= 14;
    drawRow(page, y, font, "+ Moms 25 %", String(c.arvodeMomsFormatted));
    y -= 14;
    drawRow(page, y, bold, "Arvode inkl moms", String(c.arvodeInclFormatted));
    y -= 22;
  } else {
    page.drawText(`Förhandlingstiden överstiger taxans maxgräns (3 tim 45 min).`, {
      x: MARGIN, y, size: 9, font, color: rgb(0.7, 0.3, 0),
    });
    y -= 12;
    page.drawText(`Ersättning enligt timkostnadsnormen 1 626 kr/h ex moms (DVFS 2025:6 § 8).`, {
      x: MARGIN, y, size: 9, font, color: rgb(0.7, 0.3, 0),
    });
    y -= 22;
  }

  // Utlägg (tabell + summa) — egen sektion för att hålla komplexiteten nere.
  y = drawExpenseSection(
    { page, font, bold, marginX: MARGIN, pageW: PAGE_W, lineColor: rgb(0.7, 0.7, 0.7) },
    c,
    y,
  );

  // TOTAL
  page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: PAGE_W - MARGIN, y: y + 8 }, thickness: 1, color: rgb(0, 0, 0) });
  page.drawText("TOTALT ATT FAKTURERA STATEN", { x: MARGIN, y, size: 12, font: bold });
  page.drawText(String(c.totalInclFormatted), { x: MARGIN + 350, y, size: 12, font: bold });
  y -= 28;

  // Sidfot
  const footerParts = [
    input.meta.defenderName,
    input.meta.organizationName,
    input.meta.organizationOrgNumber,
  ].filter(Boolean);
  page.drawText(footerParts.join("  ·  "), {
    x: MARGIN, y, size: 9, font, color: rgb(0.4, 0.4, 0.4),
  });

  return pdf.save();
}

interface PdfCtx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  marginX: number;
  pageW: number;
  lineColor: RGB;
}

/** Rita utläggs-tabell + summa-rad. Returnerar ny y-position. No-op om inga utlägg. */
function drawExpenseSection(ctx: PdfCtx, c: Record<string, unknown>, startY: number): number {
  // Lokal radtyp (alla fält required strings) i st.f. Record<string,string> —
  // annars ger noUncheckedIndexedAccess `string | undefined` per fält.
  const lines = (c.expenseLines as ExpenseRow[] | undefined) ?? [];
  let y = startY;
  if (lines.length === 0) return y;
  const { page, font, bold } = ctx;

  page.drawText("Utlägg", { x: ctx.marginX, y, size: 11, font: bold });
  y -= 14;
  drawTableHeader(page, y, font);
  y -= 14;
  for (const l of lines) {
    page.drawText(l.date, { x: ctx.marginX, y, size: 9, font });
    const desc = l.description.length > 30 ? l.description.slice(0, 28) + "…" : l.description;
    page.drawText(desc, { x: ctx.marginX + 70, y, size: 9, font });
    page.drawText(l.vatRateLabel, { x: ctx.marginX + 250, y, size: 9, font });
    page.drawText(l.exclVatFormatted, { x: ctx.marginX + 290, y, size: 9, font });
    page.drawText(l.vatFormatted, { x: ctx.marginX + 370, y, size: 9, font });
    page.drawText(l.inclVatFormatted, { x: ctx.marginX + 440, y, size: 9, font });
    y -= 12;
    if (y < 100) break; // safety — single-page
  }
  y -= 6;
  page.drawLine({ start: { x: ctx.marginX, y }, end: { x: ctx.pageW - ctx.marginX, y }, thickness: 0.5, color: ctx.lineColor });
  y -= 14;
  const s = c.expenseSummary as { exclVatFormatted: string; vatFormatted: string; inclVatFormatted: string };
  page.drawText("Summa utlägg", { x: ctx.marginX, y, size: 10, font: bold });
  page.drawText(s.exclVatFormatted, { x: ctx.marginX + 290, y, size: 10, font: bold });
  page.drawText(s.vatFormatted, { x: ctx.marginX + 370, y, size: 10, font: bold });
  page.drawText(s.inclVatFormatted, { x: ctx.marginX + 440, y, size: 10, font: bold });
  y -= 22;
  return y;
}

function drawRow(page: PDFPage, y: number, font: PDFFont, label: string, value: string): void {
  page.drawText(label, { x: 50, y, size: 10, font });
  page.drawText(value, { x: 50 + 350, y, size: 10, font });
}

function drawTableHeader(page: PDFPage, y: number, font: PDFFont): void {
  page.drawText("Datum", { x: 50, y, size: 8, font });
  page.drawText("Beskrivning", { x: 50 + 70, y, size: 8, font });
  page.drawText("Sats", { x: 50 + 250, y, size: 8, font });
  page.drawText("Exkl", { x: 50 + 290, y, size: 8, font });
  page.drawText("Moms", { x: 50 + 370, y, size: 8, font });
  page.drawText("Inkl", { x: 50 + 440, y, size: 8, font });
}
