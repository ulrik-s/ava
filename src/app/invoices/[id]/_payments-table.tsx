"use client";

import { formatCurrency } from "@/client/lib/utils";

interface Payment {
  id: string;
  amount: number;
  paidAt: Date | string;
  note: string | null;
  recordedBy: { name: string };
}

interface Props {
  payments: Payment[];
  paidSum: number;
}

export function PaymentsTable({ payments, paidSum }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Betalningar</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-gray-500">Inga betalningar registrerade.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500">
              <th className="text-left pb-2">Datum</th>
              <th className="text-left pb-2">Registrerad av</th>
              <th className="text-left pb-2">Notering</th>
              <th className="text-right pb-2">Belopp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="py-2">{new Date(p.paidAt).toLocaleDateString("sv-SE")}</td>
                <td className="py-2 text-gray-600">{p.recordedBy.name}</td>
                <td className="py-2 text-gray-600">{p.note ?? "—"}</td>
                <td className="py-2 text-right font-mono">{formatCurrency(p.amount)}</td>
              </tr>
            ))}
            <tr className="font-medium">
              <td colSpan={3} className="pt-3">Totalt betalat</td>
              <td className="pt-3 text-right font-mono">{formatCurrency(paidSum)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
