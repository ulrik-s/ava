/**
 * `populateInvoiceDocs` — genererar ett FAKTURA-dokument per FINAL-faktura
 * och kopplar det till fakturan (document.register med invoiceId), så att
 * faktura-detaljen kan länka till "hela bilden" — en formell faktura med
 * specifikation (tidsposter + utlägg) som ligger i ärendet.
 *
 * Bygger enkel faktura-HTML från fakturans hydrerade rader (inv.timeEntries
 * + inv.expenses). Binär-HTML skrivs via samma sink som övriga dokument.
 */

import type { GeneratorCaller } from "./backend-target";
import type { BinarySink } from "./populate-documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function fmtKr(ore: number): string {
  return (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 }) + " kr";
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
}

function timeRow(t: Any): string {
  const amount = Math.round((t.minutes / 60) * (t.hourlyRate ?? 0));
  return `<tr><td>${new Date(t.date).toLocaleDateString("sv-SE")}</td><td>${escapeHtml(t.description)}</td><td style="text-align:right">${(t.minutes / 60).toFixed(1)} h</td><td style="text-align:right">${fmtKr(t.hourlyRate ?? 0)}</td><td style="text-align:right">${fmtKr(amount)}</td></tr>`;
}

function expenseRow(e: Any): string {
  return `<tr><td>${new Date(e.date).toLocaleDateString("sv-SE")}</td><td>${escapeHtml(e.description)} (utlägg)</td><td></td><td></td><td style="text-align:right">${fmtKr(e.amount)}</td></tr>`;
}

/** Är detta rådgivnings-fakturan (klientens separata rådgivningstimme)? */
function isRadgivning(inv: Any): boolean {
  return String(inv.notes ?? "").startsWith("Rådgivningstimme");
}

function fmtHours(minutes: number): string {
  return (minutes / 60).toLocaleString("sv-SE", { maximumFractionDigits: 2 });
}

/** En rad ur den persisterade slutregleringsvyn (#878): add=svart, deduct=−(amber),
 *  info=(parentes, grå) — speglar SettlementBreakdownCard/faktura-mallen. */
function settlementRowHtml(r: Any): string {
  const amt = r.kind === "deduct" ? `−${fmtKr(r.amountOre)}` : r.kind === "info" ? `(${fmtKr(r.amountOre)})` : fmtKr(r.amountOre);
  const color = r.kind === "deduct" ? "color:#b45309" : r.kind === "info" ? "color:#9ca3af" : "";
  return `<tr style="${color}"><td>${escapeHtml(r.label)}</td><td style="text-align:right">${amt}</td></tr>`;
}

/** Rendera fakturan ur den persisterade `settlementBreakdown` (#878) — samma
 *  nedbrytning som detaljsidan + live-genererade dokumentet (tidsspec + trappa). */
function renderSettlementHtml(inv: Any): string {
  const b = inv.settlementBreakdown;
  const heading = inv.invoiceType === "CREDIT" ? "Kreditfaktura" : inv.invoiceType === "ACCONTO" ? "Aconto-faktura" : "Faktura";
  const timeTable = (b.timeLines ?? []).length
    ? `<h2 style="font-size:15px;margin-top:1.5rem;margin-bottom:.25rem">Underlag (arbetad tid)</h2>
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Datum</th><th>Beskrivning</th><th style="text-align:right">Tid</th><th style="text-align:right">Belopp</th></tr></thead>
<tbody>${b.timeLines.map((l: Any) => `<tr><td>${new Date(l.date).toLocaleDateString("sv-SE")}</td><td>${escapeHtml(l.description)}</td><td style="text-align:right">${fmtHours(l.minutes)} h</td><td style="text-align:right">${fmtKr(l.amountOre)}</td></tr>`).join("")}</tbody>
</table>`
    : "";
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>${heading} ${escapeHtml(inv.matter.matterNumber)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111">
<h1 style="margin-bottom:0">${heading}</h1>
<p style="color:#555">${escapeHtml(inv.invoiceNumber ?? "")}${inv.ocrReference ? ` · OCR: ${escapeHtml(inv.ocrReference)}` : ""}<br>Ärende ${escapeHtml(inv.matter.matterNumber)} — ${escapeHtml(inv.matter.title)}<br>Datum: ${new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</p>
${timeTable}
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin-top:1.5rem">
<tbody>${(b.rows ?? []).map(settlementRowHtml).join("")}</tbody>
<tfoot><tr style="border-top:2px solid #333"><td style="font-weight:bold">${escapeHtml(b.totalLabel)}</td><td style="text-align:right;font-weight:bold">${fmtKr(b.totalOre)}</td></tr></tfoot>
</table>
</body></html>`;
}

/** Faktura ur tids-/utläggstabellen (fallback för fakturor utan nedbrytning). */
function renderTimeTableHtml(inv: Any): string {
  const itemized = [
    ...(inv.timeEntries ?? []).map(timeRow),
    ...(inv.expenses ?? []).map(expenseRow),
  ];
  // Fakturor utan länkade tids-/utläggsposter (t.ex. rådgivnings-fakturan) fick en
  // TOM specifikation → oklart vad beloppet avser (#870). Fall tillbaka på en rad
  // ur `notes` så det alltid framgår vad som faktureras.
  const fallback = itemized.length === 0
    ? `<tr><td>${new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</td><td>${escapeHtml(inv.notes ?? "Arvode")}</td><td></td><td></td><td style="text-align:right">${fmtKr(inv.amount)}</td></tr>`
    : "";
  const rows = itemized.join("") || fallback;
  const radgivning = isRadgivning(inv);
  const heading = radgivning ? "Rådgivningsfaktura" : "Faktura";
  // Spegel av KR-notisen, sett från klientens sida: klargör att detta är den
  // separata rådgivningsdebiteringen och att den INTE ligger i domstolens KR.
  const radgivningNote = radgivning
    ? `<p style="color:#555;font-size:13px;margin-top:1rem">Rådgivningstimmen (1 tim enligt rättshjälpstaxan) faktureras klienten separat och ingår INTE i kostnadsräkningen till domstolen.</p>`
    : "";
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>${heading} ${escapeHtml(inv.matter.matterNumber)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111">
<h1 style="margin-bottom:0">${heading}</h1>
<p style="color:#555">Ärende ${escapeHtml(inv.matter.matterNumber)} — ${escapeHtml(inv.matter.title)}<br>
Datum: ${new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
<thead><tr style="border-bottom:2px solid #333;text-align:left"><th>Datum</th><th>Beskrivning</th><th style="text-align:right">Tid</th><th style="text-align:right">Timpris</th><th style="text-align:right">Belopp</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="border-top:2px solid #333"><td colspan="4" style="text-align:right;font-weight:bold">Summa</td><td style="text-align:right;font-weight:bold">${fmtKr(inv.amount)}</td></tr></tfoot>
</table>
${radgivningNote}</body></html>`;
}

/** Settlement-/aconto-/kreditfakturor har en persisterad nedbrytning (#878) → rendera
 *  den (tidsspec + moms-trappa); övriga faller tillbaka på tids-/utläggstabellen. */
function renderInvoiceHtml(inv: Any): string {
  return inv.settlementBreakdown ? renderSettlementHtml(inv) : renderTimeTableHtml(inv);
}

/** Dokument-id för en faktura. Default = läsbar `invdoc-<id>` (in-memory demo +
 *  GH Pages). Server-first (Postgres uuid-kolumn) skickar in en uuid-generator. */
export type InvoiceDocIdFn = (invoiceId: string) => string;

/** Får ett genererat dokument (#878): slutfakturor (FINAL), kreditfakturor (CREDIT),
 *  allt med en persisterad nedbrytning (aconton m. settlementBreakdown) + rådgivnings-
 *  fakturan. Så alla fakturor på ett slutreglerat ärende blir öppningsbara på GH Pages. */
function shouldGenerateDoc(summary: Any): boolean {
  if (summary.invoiceType === "FINAL" || summary.invoiceType === "CREDIT") return true;
  if (summary.settlementBreakdown != null) return true;
  return String(summary.notes ?? "").startsWith("Rådgivningstimme");
}

/** Filnamns-/titel-etikett per fakturatyp (#878). */
function docLabel(inv: Any): string {
  if (isRadgivning(inv)) return "Rådgivningsfaktura";
  if (inv.invoiceType === "CREDIT") return "Kreditfaktura";
  if (inv.invoiceType === "ACCONTO") return "Aconto-faktura";
  return "Faktura";
}

export async function populateInvoiceDocs(caller: GeneratorCaller, sink?: BinarySink, idFor?: InvoiceDocIdFn): Promise<number> {
  const c = caller as Any;
  const invoices: Any[] = await c.invoice.list({});
  let count = 0;
  for (const summary of invoices) {
    if (!shouldGenerateDoc(summary)) continue;
    const inv = await c.invoice.getById({ id: summary.id });
    const html = renderInvoiceHtml(inv);
    const id = idFor ? idFor(inv.id) : `invdoc-${inv.id}`;
    const storagePath = `documents/content/${id}.html`;
    const bytes = new TextEncoder().encode(html);
    const size = sink ? sink(storagePath, bytes) : bytes.byteLength;
    // Tydlig etikett per fakturatyp så den inte förväxlas i fil-listan (#870/#878).
    const label = docLabel(inv);
    await c.document.register({
      id, matterId: inv.matter.id, invoiceId: inv.id,
      fileName: `${label} ${inv.matter.matterNumber}.html`,
      mimeType: "text/html; charset=utf-8", sizeBytes: size, storagePath,
      title: `${label} — ${inv.matter.matterNumber}`,
      documentType: "Faktura", analysisStatus: "DONE",
      createdAt: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString() : undefined,
    });
    count++;
  }
  return count;
}
