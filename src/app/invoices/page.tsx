"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import type { InvoiceStatus, InvoiceType } from "@/lib/shared/schemas/enums";
import { SieExportButton } from "./_sie-export-button";

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
  ACCONTO: "Aconto",
  FINAL: "Slutfaktura",
};

function statusBadgeClass(status: InvoiceStatus): string {
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
  invoiceNumber?: string | null;
  invoiceDate: string | Date;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  amount: number;
  matter: { id: string; matterNumber: string; title: string };
}

const invoiceColumns: Column<InvoiceRow>[] = [
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
        {i.matter.matterNumber} — {i.matter.title}
      </EntityLink>
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
    summary: (rows) => <Money ore={rows.reduce((s, r) => s + r.amount, 0)} basis="gross" className="font-mono" />,
    render: (i) => <Money ore={i.amount} basis="gross" className="font-mono" /> },
];

export default function InvoicesPage() {
  const invoices = trpc.invoice.list.useQuery({});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Fakturor</h1>
        <div className="flex items-center gap-4">
          <SieExportButton />
          <Link href="/payments/import" className="text-sm text-blue-600 hover:underline">
            Importera betalfil →
          </Link>
        </div>
      </div>
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
