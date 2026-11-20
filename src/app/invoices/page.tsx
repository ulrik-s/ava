"use client";

import Link from "next/link";
import { useState } from "react";
import { ListPage } from "@/components/layout/list-page";
import { MatterNumber } from "@/components/matter/matter-number";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";
import { ShowHiddenToggle, useHiddenRows } from "@/components/ui/show-hidden-toggle";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { isHiddenInvoice } from "@/lib/shared/hidden-billing-rows";
import { needsAttention, type InvoiceAttention } from "@/lib/shared/invoice-overdue";
import { INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS, type InvoiceStatus, type InvoiceType } from "@/lib/shared/schemas/enums";
import { AttentionFilterButton, AttentionMarks, useInvoiceAttention } from "./_attention";
import { SieExportButton } from "./_sie-export-button";

/** Fakturatyperna, ur de delade etiketterna (förr en egen lista utan kreditfaktura,
 *  som visades som rått "CREDIT", #1309). I listan heter en standardfaktura "Faktura". */
const TYPE_LABELS: Record<InvoiceType, string> = { ...INVOICE_TYPE_LABELS, STANDARD: "Faktura" };

function statusBadgeClass(status: InvoiceStatus): string {
  switch (status) {
    case "PAID": return "bg-green-100 text-green-700";
    case "SENT": return "bg-amber-100 text-amber-700";
    case "INSTALLMENT_PLAN": return "bg-indigo-100 text-indigo-700";
    case "CANCELLED": return "bg-gray-200 text-gray-600";
    case "BAD_DEBT": return "bg-red-100 text-red-700";
    case "DRAFT": return "bg-gray-100 text-gray-600";
  }
}

interface InvoiceRow {
  id: string;
  invoiceNumber?: string | null;
  invoiceDate: string | Date;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  amount: number;
  dueDate?: string | Date | null | undefined;
  payments?: { amount: number }[] | null | undefined;
  matter: { id: string; matterNumber: string; title: string; responsibleLawyerId?: string | null };
}

/** En rad i listan, med sina röda markeringar (#1731). */
type ListedInvoice = InvoiceRow & { attention: InvoiceAttention };

const invoiceColumns: Column<ListedInvoice>[] = [
  { key: "invoiceNumber", label: "Fakturanr", sortable: true, sortValue: (i) => i.invoiceNumber ?? "",
    render: (i) => (
      <EntityLink route="invoices" id={i.id} className="text-blue-600 hover:underline font-mono text-xs">
        {i.invoiceNumber || "—"}
      </EntityLink>
    ),
  },
  { key: "invoiceDate", label: "Datum", sortable: true, sortValue: (i) => new Date(i.invoiceDate),
    // EntityLink soft-navigerar till __shell__?id (ingen omladdning). Runtime-
    // skapade faktura-id:n finns inte i generateStaticParams, så en Next-Link
    // DIREKT till /invoices/<id> skulle krascha (#418) — därför __shell__-routen.
    render: (i) => (
      <EntityLink route="invoices" id={i.id} className="text-blue-600 hover:underline">
        {new Date(i.invoiceDate).toLocaleDateString("sv-SE")}
      </EntityLink>
    ),
  },
  { key: "matter", label: "Ärende", sortable: true, sortValue: (i) => i.matter.matterNumber,
    render: (i) => (
      <EntityLink route="matters" id={i.matter.id} className="hover:underline">
        <MatterNumber matterNumber={i.matter.matterNumber} responsibleLawyerId={i.matter.responsibleLawyerId} /> — {i.matter.title}
      </EntityLink>
    ),
  },
  { key: "type", label: "Typ", sortable: true, sortValue: (i) => TYPE_LABELS[i.invoiceType],
    render: (i) => <span className="text-gray-600">{TYPE_LABELS[i.invoiceType]}</span> },
  { key: "status", label: "Status", sortable: true, sortValue: (i) => INVOICE_STATUS_LABELS[i.status] ?? i.status,
    render: (i) => (
      <>
        <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(i.status)}`}>
          {INVOICE_STATUS_LABELS[i.status] ?? i.status}
        </span>
        <AttentionMarks attention={i.attention} />
      </>
    ),
  },
  { key: "amount", label: "Belopp", sortable: true, align: "right", sortValue: (i) => i.amount,
    summary: (rows) => <Money ore={rows.reduce((s, r) => s + r.amount, 0)} basis="gross" className="font-mono" />,
    render: (i) => <Money ore={i.amount} basis="gross" className="font-mono" /> },
];

/** Listan, med annullerade fakturor och kreditfakturor dolda från början (#1522).
 *  Datan filtreras före `DataTable`, så summeringen räknar bara synliga rader.
 *  Knappen visar bara fakturor med röd markering (#1731). */
function InvoicesTable({ invoices }: { invoices: InvoiceRow[] }) {
  const { rows, toggle } = useHiddenRows(useInvoiceAttention(invoices), isHiddenInvoice);
  const [onlyMarked, setOnlyMarked] = useState(false);
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <AttentionFilterButton active={onlyMarked} onToggle={() => setOnlyMarked((v) => !v)} />
        <ShowHiddenToggle {...toggle} />
      </div>
      <DataTable
        prefKey="list.invoices"
        columns={invoiceColumns}
        data={onlyMarked ? rows.filter((r) => needsAttention(r.attention)) : rows}
        rowKey={(i) => i.id}
        emptyMessage="Inga fakturor ännu."
      />
    </>
  );
}

export default function InvoicesPage() {
  const invoices = trpc.invoice.list.useQuery({});

  return (
    <ListPage
      header={(
        <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Fakturor</h1>
        <div className="flex items-center gap-4">
          <SieExportButton />
          <Link href="/payments/import" className="text-sm text-blue-600 hover:underline">
            Importera betalfil →
          </Link>
        </div>
      </div>
        </>
      )}
    >
      {invoices.isLoading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-400">Laddar…</p>
        </div>
      ) : (
        <InvoicesTable invoices={(invoices.data?.items ?? []) as InvoiceRow[]} />
      )}
    </ListPage>
  );
}
