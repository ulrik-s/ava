"use client";

/**
 * `VerdictDialog` — andra steget för OFFENTLIG_FÖRSVARARE-flowet.
 * KOSTNADSRAKNING ligger i PENDING_VERDICT efter att advokaten skickat
 * den. Här anger advokaten ev. prutning (negativt belopp) och systemet
 * skapar Invoice + Expense(kind=PRUTNING) + fryser raderna.
 */
import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { Modal } from "@/components/ui/modal";

interface Props {
  billingRunId: string;
  workValueOre: number;
  onClose: () => void;
}

export function VerdictDialog({ billingRunId, workValueOre, onClose }: Props) {
  const [prutningKr, setPrutningKr] = useState(0);
  const mut = trpc.billingRun.setVerdict.useMutation({ onSuccess: onClose });
  const prutningOre = -Math.abs(Math.round(prutningKr * 100));
  const finalAmount = Math.max(0, workValueOre + prutningOre);

  return (
    <Modal open title="Ange dom + prutning" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate({ billingRunId, prutningOre }); }}
        className="space-y-3">
        <p className="text-sm text-gray-600">
          Domen har kommit. Ange hur mycket domstolen prutat. 0 = ingen prutning.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Pair label="Föreslaget belopp" value={formatCurrency(workValueOre)} />
          <Pair label="Slutligt belopp" value={formatCurrency(finalAmount)} highlight />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Prutning (kr, positivt tal)</label>
          <input type="number" min={0} step={1} value={prutningKr}
            onChange={(e) => setPrutningKr(parseFloat(e.target.value) || 0)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            placeholder="0" />
          <p className="mt-1 text-xs text-gray-400">
            Bokförs som Expense(kind=PRUTNING) i ärendet, syns i tids- och utläggssumman.
          </p>
        </div>
        {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={mut.isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {mut.isPending ? "Sparar…" : "Skapa slutfaktura"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Pair({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${highlight ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-gray-50"}`}>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  );
}
