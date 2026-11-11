"use client";

/**
 * Ärendets faktureringslista (#1146): billing-runs och fristående fakturor i en
 * tabell, med länkar till KR-dokument och fakturor. Annullerade körningar,
 * krediteringar, annullerade fakturor och kreditfakturor är dolda från början
 * (#1523), med samma knapp och regel som listan Fakturor (#1522). Utbruten ur
 * `_billing-panel.tsx`, som också delar raden-typerna härifrån.
 */

import { DataTable, type Column } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";
import { ShowHiddenToggle, useHiddenRows } from "@/components/ui/show-hidden-toggle";
import type { DownloadClient } from "@/lib/client/backend/load-document-blob";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { hasGeneratedDoc, openGeneratedDoc } from "@/lib/client/demo/generated-doc-cache";
import { useMatterDocuments, type MatterDocument } from "@/lib/client/documents/use-matter-documents";
import { isDemoTier } from "@/lib/client/firma/firma-config";
import { trpc } from "@/lib/client/trpc";
import { isHiddenBillingRun, isHiddenInvoice } from "@/lib/shared/hidden-billing-rows";
import type { KostnadsrakningStatus } from "@/lib/shared/kostnadsrakning-flow";
import { pickKrDocForRun } from "@/lib/shared/kr-document";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { BILLING_RUN_TYPE_LABELS, BILLING_RUN_STATUS_LABELS, INVOICE_STATUS_LABELS, type BillingRunRecipient, type BillingRunStatus, type BillingRunType, type InvoiceStatus, type InvoiceType } from "@/lib/shared/schemas/enums";
import type { BillingRunId, DocumentId, InvoiceId, MatterId } from "@/lib/shared/schemas/ids";

/** En faktureringshändelse (billing-run) som panelen och listan visar. */
export interface BillingRunRow {
  id: BillingRunId;
  type: BillingRunType;
  status: BillingRunStatus;
  recipient: BillingRunRecipient;
  amountOre: number;
  createdAt: string | Date;
  /** Aconto-satsen (bips) som gällde när acontot ställdes ut (#878) — visas i listan. */
  clientShareBips?: number | null;
  invoiceId?: InvoiceId | null;
  invoice?: { id: InvoiceId; invoiceNumber?: string | null; invoiceDate?: string | Date | null; status?: InvoiceStatus | null } | null;
  /** KR-referens `KR-YYYY-NNNN` (#889) — visas i ref-kolumnen för kostnadsräkningen. */
  reference?: string | null;
  kostnadsrakningStatus?: KostnadsrakningStatus | null;
  awardedOre?: number | null;
  beslutSlutgiltigt?: boolean | null;
  /** Registrerad prutning (negativt, netto). På rättsskyddets FORSAKRING-körning
   *  betyder den att bolagets prutning omfördelats till klientfakturan (#952). */
  prutningOre?: number | null;
}

/** Fristående klientfaktura (utan billing-run) som visas i faktura-listan (#853). */
export interface StandaloneInvoiceRow {
  id: InvoiceId; invoiceNumber?: string | null; status: InvoiceStatus; invoiceType: InvoiceType;
  amount: number; invoiceDate?: string | Date | null;
}

/** KR-dokumentet som en kostnadsräkning länkar till. */
export interface KrDocInfo { id: DocumentId; fileName: string; storagePath: string | null }

/** Körningens KR-dokument (pure — ingen hook, så den kan anropas per rad i
 *  listan): det länkade (#1230); äldre olänkade närmast körningen i tid. */
export function pickKrDoc(list: readonly MatterDocument[], run: BillingRunRow): KrDocInfo | null {
  const d = pickKrDocForRun(list, run);
  return d ? { id: d.id, fileName: d.fileName, storagePath: d.storagePath } : null;
}

/**
 * Öppna KR-dokumentet. Genererat-i-fliken → blob-cachen (öppna direkt).
 * Annars (seedat/server-hostat) → samma väg som faktura-dokumenten:
 * `openDocument` hämtar bytes från servern (`downloadContent`) eller GH Pages.
 */
export async function openKrDoc(doc: KrDocInfo, client: DownloadClient): Promise<void> {
  if (hasGeneratedDoc(doc.id)) { openGeneratedDoc(doc.id); return; }
  const { openDocument } = await import("@/lib/client/firma/open-document");
  const { loadHandle } = await import("@/lib/client/fsa/handle-store");
  const { readFromFsa } = await import("@/lib/client/fsa/read-from-fsa");
  const { loadDocumentBlob } = await import("@/lib/client/backend/load-document-blob");
  await openDocument({
    doc: { id: doc.id, ...(doc.storagePath != null ? { storagePath: doc.storagePath } : {}), fileName: doc.fileName },
    // RUNTIME-tier, inte NEXT_PUBLIC_DEMO_BUILD (sant även i lokala self-hosted-
    // builden → länkade dokument till GH Pages = 404). #844.
    isDemo: isDemoTier(),
    ...omitUndefined({ demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO }),
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    // Server-first (#518/#839): hämta bytes från servern (+ klient-cache).
    fetchBlob: () => loadDocumentBlob(client, { id: doc.id, storagePath: doc.storagePath, fileName: doc.fileName }),
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => alert(m),
  });
}

/** Datum i svensk form, "—" när det saknas. */
export const svDate = (d: string | Date | null | undefined): string => (d ? new Date(d).toLocaleDateString("sv-SE") : "—");
/** Radens kronologiska datum: fakturadatum (backdaterat i demon) före createdAt (#878). */
export const runDateOf = (r: BillingRunRow): string | Date => r.invoice?.invoiceDate ?? r.createdAt;

/** Åtgärds-cellen: KR-dokument-länk + faktura-länk. */
function RunActions({ r, docs, client }: { r: BillingRunRow; docs: readonly MatterDocument[]; client: DownloadClient }) {
  const krDoc = r.type === "KOSTNADSRAKNING" ? pickKrDoc(docs, r) : null;
  // KR:ns referens `KR-YYYY-NNNN` (#889) i samma format som fakturornas F-nummer;
  // länken öppnar KR-dokumentet (faller tillbaka på etikett om referens saknas).
  const krLabel = r.reference ?? "Kostnadsräkning";
  return (
    <span className="space-x-2 whitespace-nowrap">
      {r.type === "KOSTNADSRAKNING" && (krDoc
        ? <button type="button" onClick={() => void openKrDoc(krDoc, client)}
            className="text-xs text-blue-600 hover:underline">{krLabel}</button>
        : <span className="text-xs text-gray-500">{krLabel}</span>)}
      {/* EntityLink (hård nav) — runtime-skapade UUID:n finns ej i generateStaticParams;
          __shell__-shimen/nginx try_files resolvar dem (se [[entity-link]]). */}
      {r.invoiceId && (
        <EntityLink route="invoices" id={r.invoiceId} className="text-xs text-blue-600 hover:underline">
          {r.invoice?.invoiceNumber ?? "Faktura"}
        </EntityLink>
      )}
    </span>
  );
}

/** En rad i faktura-listan — billing-run eller fristående faktura, samma form (#1146). */
interface BillingListRow {
  key: string;
  date: string | Date | null | undefined;
  type: string;
  recipient: string;
  status: string;
  amountOre: number;
  actions: React.ReactNode;
  /** Annullerad eller kreditering — dold från början (#1523). */
  hidden: boolean;
}

/** Billing-run → listrad. Aconto visar sin sats (#878) så den varierande
 *  rättshjälpsavgiften syns per period; KR-raden länkar till sitt dokument. */
function runListRow(r: BillingRunRow, docs: readonly MatterDocument[], client: DownloadClient): BillingListRow {
  const typeLabel = BILLING_RUN_TYPE_LABELS[r.type];
  const rate = r.type === "ACCONTO" && r.clientShareBips != null ? ` (${r.clientShareBips / 100} %)` : "";
  return {
    key: r.id, date: runDateOf(r), type: `${typeLabel}${rate}`, recipient: r.recipient,
    status: BILLING_RUN_STATUS_LABELS[r.status],
    amountOre: r.amountOre, actions: <RunActions r={r} docs={docs} client={client} />,
    hidden: isHiddenBillingRun(r),
  };
}

/** Fristående klientfaktura utan billing-run (#853), t.ex. rådgivningstimmen → listrad. */
function standaloneListRow(inv: StandaloneInvoiceRow): BillingListRow {
  return {
    key: inv.id, date: inv.invoiceDate, type: "Faktura", recipient: "KLIENT",
    status: INVOICE_STATUS_LABELS[inv.status],
    amountOre: inv.amount,
    actions: (
      <EntityLink route="invoices" id={inv.id} className="text-xs text-blue-600 hover:underline">
        {inv.invoiceNumber ?? "Faktura"}
      </EntityLink>
    ),
    hidden: isHiddenInvoice(inv),
  };
}

const dateMs = (d: BillingListRow["date"]): number => (d ? new Date(d).getTime() : 0);

const BILLING_LIST_COLUMNS: Column<BillingListRow>[] = [
  { key: "date", label: "Datum", sortable: true, sortValue: (r) => dateMs(r.date),
    render: (r) => <span className="text-gray-600">{r.date ? svDate(r.date) : "—"}</span> },
  { key: "type", label: "Typ", sortable: true, sortValue: (r) => r.type, groupable: true, render: (r) => r.type },
  { key: "recipient", label: "Mottagare", sortable: true, sortValue: (r) => r.recipient, groupable: true,
    render: (r) => <span className="text-gray-600">{r.recipient}</span> },
  { key: "status", label: "Status", sortable: true, sortValue: (r) => r.status, groupable: true, render: (r) => r.status },
  { key: "amount", label: "Belopp", sortable: true, sortValue: (r) => r.amountOre, align: "right",
    render: (r) => <span className="font-mono"><Money ore={r.amountOre} basis="gross" /></span> },
  { key: "actions", label: "", align: "right", hideable: false, render: (r) => r.actions },
];

/** Ärendets faktureringslista: billing-runs + fristående fakturor i datumordning.
 *  Annullerade och krediteringar är dolda från början, som i listan Fakturor (#1523). */
export function RunsList({ matterId, rows, standalone, loading }: { matterId: MatterId; rows: BillingRunRow[]; standalone: StandaloneInvoiceRow[]; loading: boolean }) {
  // Dokumentlistan hämtas en gång → KOSTNADSRAKNING-raden kan länka till sitt KR-dokument (#843),
  // i vilken mapp det än ligger (#1308).
  const docs = useMatterDocuments(matterId) ?? [];
  const utils = trpc.useUtils();
  // Slå ihop billing-runs + fristående fakturor och sortera KRONOLOGISKT på fakturadatum
  // (#878) — annars blandas createdAt-ordning med en påklistrad standalone-grupp.
  const items = [
    ...rows.map((r) => runListRow(r, docs, utils.client)),
    ...standalone.map(standaloneListRow),
  ].sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const { rows: shown, toggle } = useHiddenRows(items, (r) => r.hidden);
  if (loading) return <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>;
  if (items.length === 0) return <p className="px-6 py-3 text-sm text-gray-500">Inga fakturor ännu.</p>;
  return (
    <div className="px-6 py-2">
      <div className="mb-2 flex justify-end"><ShowHiddenToggle {...toggle} /></div>
      <DataTable prefKey="list.matter-billing" columns={BILLING_LIST_COLUMNS} data={shown} rowKey={(r) => r.key} />
    </div>
  );
}
