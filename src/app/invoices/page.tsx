"use client";

import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { entityHref } from "@/lib/client/demo/entity-href";
import { DataTable, type Column } from "@/components/ui/data-table";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  PAID: "Betald",
  CANCELLED: "Annullerad",
  BAD_DEBT: "Kundförlust",
  INSTALLMENT_PLAN: "Avbetalningsplan",
};
const TYPE_LABELS: Record<string, string> = {
  STANDARD: "Faktura",
  ACCONTO: "Acconto",
  FINAL: "Slutfaktura",
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "PAID": return "bg-green-100 text-green-700";
    case "SENT": return "bg-amber-100 text-amber-700";
    case "INSTALLMENT_PLAN": return "bg-indigo-100 text-indigo-700";
    case "CANCELLED": return "bg-gray-200 text-gray-600";
    case "BAD_DEBT": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

interface InvoiceRow {
  id: string;
  invoiceDate: string | Date;
  invoiceType: string;
  status: string;
  amount: number;
  matter: { id: string; matterNumber: string; title: string };
}

const invoiceColumns: Column<InvoiceRow>[] = [
  { key: "invoiceDate", label: "Datum", sortable: true, sortValue: (i) => new Date(i.invoiceDate),
    // Hård <a>-nav (inte Next-Link): runtime-skapade faktura-id:n finns inte
    // i generateStaticParams → Link soft-nav hamnar i trasigt router-tillstånd
    // (#418). entityHref → 404-shim/__shell__ → useRouteId. Se [[entity-href]].
    render: (i) => (
      <a href={entityHref("invoices", i.id)} className="text-blue-600 hover:underline">
        {new Date(i.invoiceDate).toLocaleDateString("sv-SE")}
      </a>
    ),
  },
  { key: "matter", label: "Ärende", sortable: true, sortValue: (i) => i.matter.matterNumber,
    render: (i) => (
      <Link href={`/matters/${i.matter.id}`} className="hover:underline">
        {i.matter.matterNumber} — {i.matter.title}
      </Link>
    ),
  },
  { key: "type", label: "Typ", sortable: true, sortValue: (i) => TYPE_LABELS[i.invoiceType] ?? i.invoiceType,
    render: (i) => <span className="text-gray-600">{TYPE_LABELS[i.invoiceType] ?? i.invoiceType}</span> },
  { key: "status", label: "Status", sortable: true, sortValue: (i) => STATUS_LABELS[i.status] ?? i.status,
    render: (i) => (
      <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(i.status)}`}>
        {STATUS_LABELS[i.status] ?? i.status}
      </span>
    ),
  },
  { key: "amount", label: "Belopp", sortable: true, align: "right", sortValue: (i) => i.amount,
    summary: (rows) => <span className="font-mono">{formatCurrency(rows.reduce((s, r) => s + r.amount, 0))}</span>,
    render: (i) => <span className="font-mono">{formatCurrency(i.amount)}</span> },
];

export default function InvoicesPage() {
  const invoices = trpc.invoice.list.useQuery({});

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Fakturor</h1>
      {invoices.isLoading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-400">Laddar…</p>
        </div>
      ) : (
        <DataTable
          prefKey="list.invoices"
          columns={invoiceColumns}
          data={(invoices.data ?? []) as InvoiceRow[]}
          rowKey={(i) => i.id}
          emptyMessage="Inga fakturor ännu."
        />
      )}
    </div>
  );
}
