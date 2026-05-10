"use client";

import { useId, useState } from "react";

interface Props {
  invoiceId: string;
  isPending: boolean;
  error: string | null;
  onSubmit: (data: { invoiceId: string; amount: number; paidAt: string; note?: string }) => void;
  onClose: () => void;
}

export function PaymentModal({ invoiceId, isPending, error, onSubmit, onClose }: Props) {
  const [paymentAmountSek, setPaymentAmountSek] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentNote, setPaymentNote] = useState("");

  const paymentAmountId = useId();
  const paymentDateId = useId();
  const paymentNoteId = useId();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-semibold mb-4">Registrera betalning</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor={paymentAmountId} className="block text-xs font-medium mb-1">Belopp (kr)</label>
            <input id={paymentAmountId} type="number" min={1} value={paymentAmountSek} onChange={(e) => setPaymentAmountSek(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor={paymentDateId} className="block text-xs font-medium mb-1">Betalningsdatum</label>
            <input id={paymentDateId} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor={paymentNoteId} className="block text-xs font-medium mb-1">Notering</label>
            <input id={paymentNoteId} value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
          <button
            disabled={!paymentAmountSek || isPending}
            onClick={() => onSubmit({
              invoiceId,
              amount: Math.round(Number(paymentAmountSek) * 100),
              paidAt: paymentDate,
              note: paymentNote || undefined,
            })}
            className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {isPending ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>
    </div>
  );
}
