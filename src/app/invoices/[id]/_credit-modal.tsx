"use client";

import { useId, useState } from "react";
import { formatCurrency } from "@/client/lib/utils";

interface Props {
  invoiceId: string;
  amount: number;
  hasActivePlan: boolean;
  isPending: boolean;
  error: string | null;
  onSubmit: (data: { invoiceId: string; notes?: string }) => void;
  onClose: () => void;
}

export function CreditModal({ invoiceId, amount, hasActivePlan, isPending, error, onSubmit, onClose }: Props) {
  const [creditNotes, setCreditNotes] = useState("");
  const creditNotesId = useId();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-semibold mb-2">Kreditera faktura</h3>
        <p className="text-sm text-gray-600 mb-4">
          En kreditfaktura på <span className="font-mono">{formatCurrency(-amount)}</span> skapas
          och den ursprungliga fakturan annulleras.
          {hasActivePlan && " Pågående avbetalningsplan kommer att avbrytas."}
        </p>
        <div className="space-y-3">
          <div>
            <label htmlFor={creditNotesId} className="block text-xs font-medium mb-1">Notering (valfri)</label>
            <textarea
              id={creditNotesId}
              value={creditNotes}
              onChange={(e) => setCreditNotes(e.target.value)}
              rows={3}
              placeholder="T.ex. anledning till kreditering"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
          <button
            disabled={isPending}
            onClick={() => onSubmit({ invoiceId, notes: creditNotes || undefined })}
            className="px-4 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
          >
            {isPending ? "Krediterar…" : "Kreditera"}
          </button>
        </div>
      </div>
    </div>
  );
}
