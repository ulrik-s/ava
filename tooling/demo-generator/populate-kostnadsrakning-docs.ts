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
 * Speglar `populateInvoiceDocs`: renderar default-mallen till HTML, skriver binären via
 * sink:en och registrerar via `document.register` med
 * documentType="Kostnadsräkning" (samma tagg som `kostnadsrakning.record`
 * sätter i prod, så `findKrDocument` i billing-panelen hittar den).
 */

import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";
import { KOSTNADSRAKNING_DEFAULT_HTML } from "@/lib/shared/kostnadsrakning-template";
import type { BinarySink, GeneratorCaller } from "./backend-target";
import { ensureFolderPath, KOSTNADSRAKNING_FOLDER, type FolderCache } from "./folder-filing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** KR-dokumentet (#864, #1218): byråns default-mall renderad ur den delade
 *  contexten — samma layout och innehåll som i appen. */
function renderKrHtml(tc: Record<string, unknown>): string {
  return renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, tc);
}

/** Byråns fält till dokumentet (null → utelämnat). */
function orgFields(org: Any): Record<string, string> {
  const keys = ["name", "orgNumber", "address", "phone", "email", "bankgiro", "website", "logo", "footerSeal"] as const;
  return Object.fromEntries(keys.filter((k) => typeof org?.[k] === "string").map((k) => [k, org[k] as string]));
}

/**
 * Huvudförhandlingen och taxan ur ärendet (#1024): ett taxeärende (offentligt
 * uppdrag) yrkar brottmålstaxan på den sparade HUF-tiden — samma underlag som
 * körningen räknades på (`createKostnadsrakning`), så dokumentet och "yrkat"
 * stämmer. Övriga har ingen huvudförhandling i dessa KR:er.
 */
function taxaFields(m: Any, date: Date): Record<string, unknown> {
  const isTaxe = m.paymentMethod === "OFFENTLIGT_UPPDRAG" && m.isTaxeArende === true && m.taxaHuvudforhandlingMin != null;
  if (!isTaxe) return { hufStart: date, hufEnd: date, isTaxeArende: false };
  const start = m.taxaHufStart ? new Date(m.taxaHufStart) : date;
  return {
    hufStart: start, hufEnd: new Date(start.getTime() + Number(m.taxaHuvudforhandlingMin) * 60_000),
    isTaxeArende: true, taxaLevel: m.taxaLevel ?? 1,
  };
}

/** Bygg KR-contexten för en run ur ärendets tids-/utläggsposter (#864). */
async function krContextFor(c: Any, run: Any): Promise<Any> {
  const matter = run.matter ?? {};
  const date = run.createdAt ? new Date(run.createdAt) : new Date();
  const [te, ex, org, full] = await Promise.all([
    c.timeEntry.list({ matterId: matter.id, pageSize: 100 }),
    c.expense.list({ matterId: matter.id }),
    c.organization.getSettings(),
    c.matter.getById({ id: matter.id }),
  ]);
  const result = buildKostnadsrakningContext({
    matter: { matterNumber: matter.matterNumber, title: matter.title, clientName: matter.clientName ?? undefined, radgivningPaid: matter.paymentMethod === "RATTSHJALP", courtCaseNumber: matter.courtCaseNumber ?? undefined },
    // Brevhuvud + sidfot (#1218) ur byråinställningarna.
    organization: orgFields(org),
    defender: { name: matter.responsibleLawyerName ?? "Ansvarig jurist" },
    ...taxaFields(full, date),
    // Yrkandet framställdes när KR-runnen skapades (#980) — det styr både
    // normvalet och räkningens datum i dokumentet. Explicit, så det inte råkar
    // följa med hufEnd om de fälten någon gång får riktiga förhandlingstider.
    yrkandeDate: date,
    hasFTax: true,
    timeEntries: (te.entries ?? []) as Any,
    // Posterna run:en frös är dess underlag; övriga låsta (t.ex. rådgivningen) utelämnas (#1205).
    ownBillingRunId: run.id,
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
  // Kostnadsräkningen går till domstolen men får en egen hylla där (#985).
  const folders: FolderCache = new Map();
  let count = 0;
  for (const summary of runs as Any[]) {
    if (summary.type !== "KOSTNADSRAKNING") continue;
    const run = await c.billingRun.byId({ id: summary.id });
    const tc = await krContextFor(c, run);
    const html = renderKrHtml(tc);
    const id = idFor ? idFor(run.id) : `krdoc-${run.id}`;
    const storagePath = `documents/content/${id}.html`;
    const bytes = new TextEncoder().encode(html);
    const size = sink ? sink(storagePath, bytes) : bytes.byteLength;
    const folderId = await ensureFolderPath(c, String(run.matter.id), KOSTNADSRAKNING_FOLDER, folders);
    await c.document.register({
      id, matterId: run.matter.id, folderId,
      invoiceId: run.invoiceId ?? undefined,
      // Länkad till sin körning (#1230) — ångras den tas dokumentet bort.
      billingRunId: run.id,
      fileName: `Kostnadsräkning ${run.matter.matterNumber}.html`,
      mimeType: "text/html; charset=utf-8", sizeBytes: size, storagePath,
      title: `Kostnadsräkning — ${run.matter.matterNumber}`,
      documentType: "Kostnadsräkning", analysisStatus: "DONE",
      // Kostnadsräkningen skickas till domstolen (#901) → syns i "skickat till domstol"-filtret.
      direction: "UTGAENDE", recipient: "DOMSTOL",
      createdAt: run.createdAt ? new Date(run.createdAt).toISOString() : undefined,
    });
    count++;
  }
  return count;
}
