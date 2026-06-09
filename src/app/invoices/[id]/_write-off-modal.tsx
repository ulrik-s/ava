"use client";

/**
 * Modal för att boka en konstaterad kundförlust (ADR 0007) via `invoice.writeOff`.
 * Default-belopp = hela utestående; advokaten kan ange anledning + datum.
 */

import { useId, useState } from "react";

interface Props {
  invoiceId: string;
  /** Utestående i öre — default-belopp för avskrivningen. */
  outstanding: number;
  isPending: boolean;
  error: string | null;
  onSubmit: (data: { invoiceId: string; amount: number; reason?: string; writtenOffAt: string }) => void;
  onClose: () => void;
}

export function WriteOffModal({ invoiceId, outstanding, isPending, error, onSubmit, onClose }: Props) {
  const [amountSek, setAmountSek] = useState(String(Math.round(outstanding / 100)));
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const amountId = useId();
  const reasonId = useId();
  const dateId = useId();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-semibold mb-1">Skriv av som kundförlust</h3>
        <p className="text-xs text-gray-500 mb-4">
          Bokar en konstaterad kundförlust. Fakturan markeras som Kundförlust när
          återstoden skrivs av.
        </p>
        <div className="space-y-3">
          <div>
            <label htmlFor={amountId} className="block text-xs font-medium mb-1">Belopp att skriva av (kr)</label>
            <input id={amountId} type="number" min={1} value={amountSek} onChange={(e) => setAmountSek(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor={reasonId} className="block text-xs font-medium mb-1">Anledning</label>
            <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="t.ex. Klient försatt i konkurs" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor={dateId} className="block text-xs font-medium mb-1">Avskrivningsdatum</label>
            <input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
          <button
            disabled={!amountSek || isPending}
            onClick={() => onSubmit({
              invoiceId,
              amount: Math.round(Number(amountSek) * 100),
              writtenOffAt: date,
              ...(reason ? { reason } : {}),
            })}
            className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Sparar…" : "Skriv av"}
          </button>
        </div>
      </div>
    </div>
  );
}
