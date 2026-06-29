/**
 * `populateKostnadsrakningDocs` — genererar ett KOSTNADSRÄKNING-dokument
 * per KOSTNADSRAKNING-billing-run och kopplar det till ärendet.
 *
 * Varför: i appens riktiga flöde skapas kostnadsräknings-DOKUMENTET först
 * (i `KostnadsrakningModal` → klient-genererad PDF) och DÄREFTER billing-
 * run:n (`createKostnadsrakning`). Demo-generatorn anropade tidigare bara
 * `createKostnadsrakning` direkt — billing-run:n hamnade i PENDING_VERDICT
 * UTAN något dokument. Resultat: ärendet visade "Kostnadsräkning väntar på
 * dom" trots att ingen kostnadsräkning fanns (t.ex. brottmål ekobrott
 * Carlsson). Den här stegen återställer kohärensen genom att skapa
 * dokumentet som billing-run:n förutsätter.
 *
 * Speglar `populateInvoiceDocs`: bygger enkel HTML, skriver binären via
 * sink:en och registrerar via `document.register` med
 * documentType="Kostnadsräkning" (samma tagg som `kostnadsrakning.record`
 * sätter i prod, så `findKrDocument` i billing-panelen hittar den).
 */

import { radgivningTextRad } from "@/lib/shared/rattshjalp";
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

function renderKrHtml(run: Any): string {
  const matter = run.matter ?? {};
  const amountOre = run.proposedAmountOre ?? run.amountOre ?? 0;
  const date = run.createdAt ? new Date(run.createdAt) : new Date();
  // Rättshjälp (#383/#848): rådgivningstimmen redovisas som textrad (utan belopp)
  // — mötet ägt rum men timmen ingår inte i KR-totalen (faktureras klienten separat).
  const radgivningRad = matter.paymentMethod === "RATTSHJALP"
    ? `<p style="color:#555;font-size:13px;margin-top:1rem">${escapeHtml(radgivningTextRad())}</p>`
    : "";
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>Kostnadsräkning ${escapeHtml(matter.matterNumber)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111">
<h1 style="margin-bottom:0">Kostnadsräkning</h1>
<p style="color:#555">Ärende ${escapeHtml(matter.matterNumber)} — ${escapeHtml(matter.title)}<br>
Ställd till: Domstol<br>
Datum: ${date.toLocaleDateString("sv-SE")}</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
<tbody>
<tr><td>Begärt belopp</td><td style="text-align:right">${fmtKr(amountOre)}</td></tr>
</tbody>
<tfoot><tr style="border-top:2px solid #333"><td style="font-weight:bold">Summa att fastställa av rätten</td><td style="text-align:right;font-weight:bold">${fmtKr(amountOre)}</td></tr></tfoot>
</table>
${radgivningRad}
<p style="color:#777;font-size:13px;margin-top:1.5rem">Kostnadsräkningen är inlämnad och väntar på rättens prövning (dom).</p>
</body></html>`;
}

/** Dokument-id för en KR-run. Default = läsbar `krdoc-<runId>` (in-memory demo +
 *  GH Pages). Server-first (Postgres uuid-kolumn) skickar in en uuid-generator. */
export type KrDocIdFn = (runId: string) => string;

export async function populateKostnadsrakningDocs(caller: GeneratorCaller, sink?: BinarySink, idFor?: KrDocIdFn): Promise<number> {
  const c = caller as Any;
  const { runs } = await c.billingRun.list({});
  let count = 0;
  for (const summary of runs as Any[]) {
    if (summary.type !== "KOSTNADSRAKNING") continue;
    const run = await c.billingRun.byId({ id: summary.id });
    const html = renderKrHtml(run);
    const id = idFor ? idFor(run.id) : `krdoc-${run.id}`;
    const storagePath = `documents/content/${id}.html`;
    const bytes = new TextEncoder().encode(html);
    const size = sink ? sink(storagePath, bytes) : bytes.byteLength;
    await c.document.register({
      id, matterId: run.matter.id,
      invoiceId: run.invoiceId ?? undefined,
      fileName: `Kostnadsräkning ${run.matter.matterNumber}.html`,
      mimeType: "text/html; charset=utf-8", sizeBytes: size, storagePath,
      title: `Kostnadsräkning — ${run.matter.matterNumber}`,
      documentType: "Kostnadsräkning", analysisStatus: "DONE",
      createdAt: run.createdAt ? new Date(run.createdAt).toISOString() : undefined,
    });
    count++;
  }
  return count;
}
