"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";

interface Payment {
  id: string;
  amount: number;
  paidAt: Date | string;
  note?: string | null | undefined;
  recordedBy: { name: string } | null;
}

interface Props {
  payments: Payment[];
  paidSum: number;
}

const COLUMNS: Column<Payment>[] = [
  { key: "paidAt", label: "Datum", sortable: true, sortValue: (p) => new Date(p.paidAt).getTime(),
    render: (p) => new Date(p.paidAt).toLocaleDateString("sv-SE") },
  { key: "recordedBy", label: "Registrerad av", sortable: true, sortValue: (p) => p.recordedBy?.name ?? "",
    render: (p) => <span className="text-gray-600">{p.recordedBy?.name ?? "—"}</span> },
  { key: "note", label: "Notering", wrap: true, render: (p) => <span className="text-gray-600">{p.note ?? "—"}</span> },
  { key: "amount", label: "Belopp", sortable: true, sortValue: (p) => p.amount, align: "right",
    render: (p) => <Money ore={p.amount} basis="gross" className="font-mono" /> },
];

export function PaymentsTable({ payments, paidSum }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Betalningar</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-gray-500">Inga betalningar registrerade.</p>
      ) : (
        <DataTable prefKey="list.invoice-payments" columns={COLUMNS} data={payments} rowKey={(p) => p.id}
          footer={() => ({
            paidAt: <span className="font-medium">Totalt betalat</span>,
            amount: <Money ore={paidSum} basis="gross" className="font-mono font-medium" />,
          })} />
      )}
    </div>
  );
}
