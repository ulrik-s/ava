/**
 * `populateInvoiceDocs` — genererar ett FAKTURA-dokument per faktura och kopplar
 * det till fakturan (document.register med invoiceId), så att faktura-detaljen
 * kan länka till "hela bilden" — en formell faktura som ligger i ärendet.
 *
 * HTML:en renderas med APPENS delade faktura-mall (`renderFakturaHtml`, #937) —
 * demon hade tidigare en EGEN renderare, så mall-ändringar (sammanställning på
 * första sidan + specifikation därefter) nådde aldrig demons fakturor. Nu finns
 * en enda renderare, och underlaget hämtas ur samma router som appen använder
 * (`billingRun.invoiceSpecification`).
 */

import { fakturaHeading, renderFakturaHtml, type FakturaBreakdown } from "@/lib/client/kostnadsrakning/faktura-template";
import { BILLING_RUN_RECIPIENT_LABELS } from "@/lib/shared/schemas/enums";
import type { BinarySink, GeneratorCaller } from "./backend-target";
import { ensureFolderPath, INVOICE_FOLDER, type FolderCache } from "./folder-filing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

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

/** Nedbrytningen (#878/#880) → mall-argumentet. Tidsraderna följer med så
 *  specifikationen kan renderas även när arbetet ligger på motpartens faktura. */
function breakdownOf(inv: Any): FakturaBreakdown | null {
  const b = inv.settlementBreakdown;
  if (!b) return null;
  return { rows: b.rows ?? [], totalLabel: b.totalLabel, totalOre: b.totalOre, timeLines: b.timeLines ?? [] };
}

/** Uppslag som gäller hela byrån och därför hämtas EN gång, inte per faktura. */
interface DocLookups {
  /** invoiceId → billing-runs mottagare (KLIENT/FORSAKRING/RATTSHJALPSMYNDIGHET/DOMSTOL). */
  recipientByInvoice: Map<string, string>;
  /** matterId → klientens namn (ärendelistans KLIENT-include). */
  clientByMatter: Map<string, string>;
}

async function loadLookups(c: Any): Promise<DocLookups> {
  const [runsRes, mattersRes] = await Promise.all([c.billingRun.list({}), c.matter.list({ pageSize: 500 })]);
  const runs: Any[] = runsRes?.runs ?? [];
  const matters: Any[] = mattersRes?.matters ?? [];
  return {
    recipientByInvoice: new Map(runs.filter((r) => r.invoiceId).map((r) => [String(r.invoiceId), String(r.recipient)])),
    clientByMatter: new Map(matters.map((m) => [String(m.id), clientNameOf(m)]).filter((e): e is [string, string] => !!e[1])),
  };
}

function clientNameOf(matter: Any): string | undefined {
  const link = (matter.contacts ?? []).find((mc: Any) => mc.role === "KLIENT");
  return link?.contact?.name ?? undefined;
}

/**
 * Mottagar-etikett: härledd ur den billing-run som skapade fakturan (dess
 * `recipient`), så domstols-/försäkrings-/klientfakturor får rätt mottagare.
 * Klientfakturor (och fakturor utan run, t.ex. rådgivningstimmen) → klientens namn.
 */
function recipientOf(inv: Any, l: DocLookups): string {
  const recipient = l.recipientByInvoice.get(String(inv.id));
  if (recipient && recipient !== "KLIENT") return payerLabel(recipient);
  return l.clientByMatter.get(String(inv.matter.id)) ?? BILLING_RUN_RECIPIENT_LABELS.KLIENT;
}

function payerLabel(recipient: string): string {
  return BILLING_RUN_RECIPIENT_LABELS[recipient as keyof typeof BILLING_RUN_RECIPIENT_LABELS] ?? recipient;
}

/** Fakturans HTML via appens mall — sammanställning först, specifikation efter. */
async function renderDoc(c: Any, inv: Any, l: DocLookups): Promise<string> {
  const spec = await c.billingRun.invoiceSpecification({ matterId: inv.matter.id, invoiceId: inv.id });
  return renderFakturaHtml({
    invoice: {
      id: inv.id, amount: inv.amount, vatOre: inv.vatOre, invoiceNumber: inv.invoiceNumber,
      ocrReference: inv.ocrReference, invoiceDate: inv.invoiceDate, invoiceType: inv.invoiceType, notes: inv.notes,
    },
    recipient: recipientOf(inv, l),
    meta: { matterNumber: inv.matter.matterNumber, matterTitle: inv.matter.title },
    spec, breakdown: breakdownOf(inv),
  });
}

export async function populateInvoiceDocs(caller: GeneratorCaller, sink?: BinarySink, idFor?: InvoiceDocIdFn): Promise<number> {
  const c = caller as Any;
  const invoices: Any[] = await c.invoice.list({});
  const lookups = await loadLookups(c);
  // Fakturadokumenten filas som allt annat (#985) — utan mapp hade 46 av demons
  // 121 dokument legat kvar i roten och trädet sett halvsorterat ut.
  const folders: FolderCache = new Map();
  let count = 0;
  for (const summary of invoices) {
    if (!shouldGenerateDoc(summary)) continue;
    const inv = await c.invoice.getById({ id: summary.id });
    const html = await renderDoc(c, inv, lookups);
    const id = idFor ? idFor(inv.id) : `invdoc-${inv.id}`;
    const storagePath = `documents/content/${id}.html`;
    const bytes = new TextEncoder().encode(html);
    const size = sink ? sink(storagePath, bytes) : bytes.byteLength;
    // Tydlig etikett per fakturatyp så den inte förväxlas i fil-listan (#870/#878)
    // — samma rubrik som mallen sätter i dokumentet.
    const label = fakturaHeading(inv);
    const folderId = await ensureFolderPath(c, String(inv.matter.id), INVOICE_FOLDER, folders);
    await c.document.register({
      id, matterId: inv.matter.id, invoiceId: inv.id, folderId,
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
