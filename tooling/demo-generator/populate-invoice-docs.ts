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

function renderInvoiceHtml(inv: Any): string {
  const rows = [
    ...(inv.timeEntries ?? []).map(timeRow),
    ...(inv.expenses ?? []).map(expenseRow),
  ].join("");
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>Faktura ${escapeHtml(inv.matter.matterNumber)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111">
<h1 style="margin-bottom:0">Faktura</h1>
<p style="color:#555">Ärende ${escapeHtml(inv.matter.matterNumber)} — ${escapeHtml(inv.matter.title)}<br>
Datum: ${new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
<thead><tr style="border-bottom:2px solid #333;text-align:left"><th>Datum</th><th>Beskrivning</th><th style="text-align:right">Tid</th><th style="text-align:right">Timpris</th><th style="text-align:right">Belopp</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="border-top:2px solid #333"><td colspan="4" style="text-align:right;font-weight:bold">Summa</td><td style="text-align:right;font-weight:bold">${fmtKr(inv.amount)}</td></tr></tfoot>
</table></body></html>`;
}

/** Dokument-id för en faktura. Default = läsbar `invdoc-<id>` (in-memory demo +
 *  GH Pages). Server-first (Postgres uuid-kolumn) skickar in en uuid-generator. */
export type InvoiceDocIdFn = (invoiceId: string) => string;

/** Får ett genererat dokument: slutfakturor (FINAL) + rådgivnings-fakturan, som
 *  nu är ett ACCONTO (#851) men ska synas i dokumentlistan (#843). Övriga aconton
 *  (självrisk) genererar inte dokument. */
function shouldGenerateDoc(summary: Any): boolean {
  if (summary.invoiceType === "FINAL") return true;
  return String(summary.notes ?? "").startsWith("Rådgivningstimme");
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
    await c.document.register({
      id, matterId: inv.matter.id, invoiceId: inv.id,
      fileName: `Faktura ${inv.matter.matterNumber}.html`,
      mimeType: "text/html; charset=utf-8", sizeBytes: size, storagePath,
      title: `Faktura — ${inv.matter.matterNumber}`,
      documentType: "Faktura", analysisStatus: "DONE",
      createdAt: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString() : undefined,
    });
    count++;
  }
  return count;
}
