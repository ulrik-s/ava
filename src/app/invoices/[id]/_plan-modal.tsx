"use client";

import { useId, useState } from "react";

interface Props {
  invoiceId: string;
  isPending: boolean;
  error: string | null;
  onSubmit: (data: {
    invoiceId: string;
    monthlyAmount: number;
    dayOfMonth: number;
    startDate: string;
    notes?: string;
  }) => void;
  onClose: () => void;
}

export function PlanModal({ invoiceId, isPending, error, onSubmit, onClose }: Props) {
  const [planMonthlySek, setPlanMonthlySek] = useState("");
  const [planDayOfMonth, setPlanDayOfMonth] = useState("1");
  const [planStart, setPlanStart] = useState(new Date().toISOString().slice(0, 10));
  const [planNotes, setPlanNotes] = useState("");

  const planMonthlyId = useId();
  const planDayOfMonthId = useId();
  const planStartId = useId();
  const planNotesId = useId();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-semibold mb-4">Skapa avbetalningsplan</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor={planMonthlyId} className="block text-xs font-medium mb-1">Månadsbelopp (kr)</label>
            <input id={planMonthlyId} type="number" min={1} value={planMonthlySek} onChange={(e) => setPlanMonthlySek(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor={planDayOfMonthId} className="block text-xs font-medium mb-1">Förfallodag i månaden (1-28)</label>
            <input id={planDayOfMonthId} type="number" min={1} max={28} value={planDayOfMonth} onChange={(e) => setPlanDayOfMonth(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor={planStartId} className="block text-xs font-medium mb-1">Startdatum</label>
            <input id={planStartId} type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor={planNotesId} className="block text-xs font-medium mb-1">Notering</label>
            <textarea id={planNotesId} value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
          <button
            disabled={!planMonthlySek || isPending}
            onClick={() => onSubmit({
              invoiceId,
              monthlyAmount: Math.round(Number(planMonthlySek) * 100),
              dayOfMonth: Number(planDayOfMonth),
              startDate: planStart,
              ...(planNotes ? { notes: planNotes } : {}),
            })}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? "Skapar…" : "Skapa plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
