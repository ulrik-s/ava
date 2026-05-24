"use client";

import Link from "next/link";
import { trpc } from "@/client/lib/trpc";
import { formatCurrency } from "@/client/lib/utils";

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

export default function InvoicesPage() {
  const invoices = trpc.invoice.list.useQuery({});

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Fakturor</h1>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {invoices.isLoading ? (
          <p className="p-6 text-sm text-gray-400">Laddar…</p>
        ) : (invoices.data ?? []).length === 0 ? (
          <p className="p-6 text-sm text-gray-500">Inga fakturor ännu.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500">Datum</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500">Ärende</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500">Typ</th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-6 py-2 text-right text-xs font-medium text-gray-500">Belopp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.data!.map((inv) => (
                <tr key={inv.id} className="text-sm hover:bg-gray-50">
                  <td className="px-6 py-2">
                    <Link href={`/invoices/${inv.id}`} className="text-blue-600 hover:underline">
                      {new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}
                    </Link>
                  </td>
                  <td className="px-6 py-2">
                    <Link href={`/matters/${inv.matter.id}`} className="hover:underline">
                      {inv.matter.matterNumber} — {inv.matter.title}
                    </Link>
                  </td>
                  <td className="px-6 py-2 text-gray-600">{TYPE_LABELS[inv.invoiceType] ?? inv.invoiceType}</td>
                  <td className="px-6 py-2">
                    <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(inv.status)}`}>
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="px-6 py-2 text-right font-mono">{formatCurrency(inv.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
