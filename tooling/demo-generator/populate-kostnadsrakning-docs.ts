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

import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";
import type { GeneratorCaller } from "./backend-target";
import type { BinarySink } from "./populate-documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
}

/** Tidsspecifikations-tabell. Icke-taxa (#891): datum · åtgärd · á-pris · antal ·
 *  totalt (arbete resp. tidsspillan på sin taxa) + summa (timmar + belopp, INGET
 *  á-pris på summaraden). Taxa-ärenden: datum · åtgärd · tid (beloppet styrs av taxan). */
function timeSpecHtml(tc: Any): string {
  const lines = (tc.timeLines as Any[]) ?? [];
  if (lines.length === 0) return "";
  const num = "text-align:right";
  if (!tc.isTimkostnadsnorm) {
    const rows = lines.map((l) => `<tr><td>${escapeHtml(l.date)}</td><td>${escapeHtml(l.description)}</td><td style="${num}">${escapeHtml(l.minutesFormatted)}</td></tr>`).join("");
    return `<h2 style="font-size:15px;margin-top:1.5rem;margin-bottom:.25rem">Tidsspecifikation</h2>
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Datum</th><th>Åtgärd</th><th style="${num}">Tid</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="border-top:1px solid #ccc"><td colspan="2" style="font-weight:bold">Summa arbetstid</td><td style="${num};font-weight:bold">${escapeHtml(tc.billableArbetsFormatted)}</td></tr></tfoot>
</table>`;
  }
  const rows = lines.map((l) => `<tr><td>${escapeHtml(l.date)}</td><td>${escapeHtml(l.description)}${l.isTidsspillan ? " <span style=\"color:#888\">(tidsspillan)</span>" : ""}</td><td style="${num}">${escapeHtml(l.rateFormatted)}</td><td style="${num}">${escapeHtml(l.hoursFormatted)}</td><td style="${num}">${escapeHtml(l.amountFormatted)}</td></tr>`).join("");
  return `<h2 style="font-size:15px;margin-top:1.5rem;margin-bottom:.25rem">Tidsspecifikation</h2>
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Datum</th><th>Åtgärd</th><th style="${num}">Á-pris</th><th style="${num}">Antal</th><th style="${num}">Totalt (exkl moms)</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="border-top:1px solid #ccc"><td colspan="2" style="font-weight:bold">Summa</td><td></td><td style="${num};font-weight:bold">${escapeHtml(tc.billableArbetsFormatted)}</td><td style="${num};font-weight:bold">${escapeHtml(tc.arvodeExclFormatted)}</td></tr></tfoot>
</table>`;
}

/** Utläggsspecifikations-tabell (datum · beskrivning · moms · netto · brutto). */
function expenseSpecHtml(tc: Any): string {
  const lines = (tc.expenseLines as Any[]) ?? [];
  if (lines.length === 0) return "";
  const rows = lines.map((l) => `<tr><td>${escapeHtml(l.date)}</td><td>${escapeHtml(l.description)}</td><td style="text-align:right">${escapeHtml(l.vatRateLabel)}</td><td style="text-align:right">${escapeHtml(l.exclVatFormatted)}</td><td style="text-align:right">${escapeHtml(l.inclVatFormatted)}</td></tr>`).join("");
  const s = tc.expenseSummary as Any;
  return `<h2 style="font-size:15px;margin-top:1.5rem;margin-bottom:.25rem">Utläggsspecifikation</h2>
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Datum</th><th>Beskrivning</th><th style="text-align:right">Moms</th><th style="text-align:right">Netto</th><th style="text-align:right">Brutto</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="border-top:1px solid #ccc"><td colspan="3" style="font-weight:bold">Summa utlägg</td><td style="text-align:right;font-weight:bold">${escapeHtml(s.exclVatFormatted)}</td><td style="text-align:right;font-weight:bold">${escapeHtml(s.inclVatFormatted)}</td></tr></tfoot>
</table>`;
}

/** Full KR-specifikation (#864): tidsspec + arvode + utlägg + total + rådgivnings-
 *  notis — samma innehåll som klient-PDF:en, byggd ur den delade contexten. */
function renderKrHtml(run: Any, tc: Any): string {
  const matter = run.matter ?? {};
  const date = run.createdAt ? new Date(run.createdAt) : new Date();
  const arvodeTitle = tc.isTimkostnadsnorm ? "Arvode (timkostnadsnormen)" : "Arvode (brottmålstaxa)";
  const note = (tc.taxaNotes as string[] | undefined)?.[0];
  const noteRad = note ? `<p style="color:#888;font-size:11px;margin:.25rem 0">${escapeHtml(note)}</p>` : "";
  const radgivningRad = tc.radgivningNotice ? `<p style="color:#555;font-size:13px;margin-top:1rem">${escapeHtml(tc.radgivningNotice)}</p>` : "";
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>Kostnadsräkning ${escapeHtml(matter.matterNumber)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111">
<h1 style="margin-bottom:0">Kostnadsräkning</h1>
<p style="color:#555">Ärende ${escapeHtml(matter.matterNumber)} — ${escapeHtml(matter.title)}<br>
Ställd till: Domstol<br>
Datum: ${date.toLocaleDateString("sv-SE")}</p>
${timeSpecHtml(tc)}
<h2 style="font-size:15px;margin-top:1.5rem;margin-bottom:.25rem">${arvodeTitle}</h2>
${noteRad}
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
<tbody>
<tr><td>Arvode exkl moms</td><td style="text-align:right">${escapeHtml(tc.arvodeExclFormatted)}</td></tr>
<tr><td>+ Moms 25 %</td><td style="text-align:right">${escapeHtml(tc.arvodeMomsFormatted)}</td></tr>
<tr style="border-top:1px solid #ccc"><td style="font-weight:bold">Arvode inkl moms</td><td style="text-align:right;font-weight:bold">${escapeHtml(tc.arvodeInclFormatted)}</td></tr>
</tbody></table>
${expenseSpecHtml(tc)}
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin-top:1rem">
<tfoot><tr style="border-top:2px solid #333"><td style="font-weight:bold">Summa att fastställa av rätten</td><td style="text-align:right;font-weight:bold">${escapeHtml(tc.totalInclFormatted)}</td></tr></tfoot>
</table>
${radgivningRad}
<p style="color:#777;font-size:13px;margin-top:1.5rem">Kostnadsräkningen är inlämnad och väntar på rättens prövning (dom).</p>
</body></html>`;
}

/** Bygg KR-contexten för en run ur ärendets tids-/utläggsposter (#864). */
async function krContextFor(c: Any, run: Any): Promise<Any> {
  const matter = run.matter ?? {};
  const date = run.createdAt ? new Date(run.createdAt) : new Date();
  const [te, ex] = await Promise.all([
    c.timeEntry.list({ matterId: matter.id, pageSize: 100 }),
    c.expense.list({ matterId: matter.id }),
  ]);
  const result = buildKostnadsrakningContext({
    matter: { matterNumber: matter.matterNumber, title: matter.title, clientName: matter.clientName ?? undefined, radgivningPaid: matter.paymentMethod === "RATTSHJALP" },
    defender: { name: matter.responsibleLawyerName ?? "Ansvarig jurist" },
    hufStart: date, hufEnd: date, // ingen huvudförhandling i dessa KR:er
    isTaxeArende: false, hasFTax: true,
    timeEntries: (te.entries ?? []) as Any,
    expenses: (ex.expenses ?? []) as Any,
  });
  return result.templateContext;
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
    const tc = await krContextFor(c, run);
    const html = renderKrHtml(run, tc);
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
