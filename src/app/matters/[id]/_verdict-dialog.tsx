"use client";

/**
 * `VerdictDialog` — andra steget för OFFENTLIG_FÖRSVARARE-flowet.
 *
 * Kostnadsräkningen ligger i PENDING_VERDICT efter att advokaten skickat
 * den. Här anger advokaten det belopp som domen beviljade. Systemet
 * räknar baklänges till prutningen (= dömt − föreslaget) och skapar
 * Invoice + ev. Expense(kind=PRUTNING) + fryser raderna.
 *
 * Domen anger det FAKTISKA beloppet, inte hur mycket som prutats — så
 * det är vad advokaten skriver in.
 */
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { generateFakturaDoc, type DocUtils } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { omitUndefined } from "@/lib/shared/omit-undefined";

interface Props {
  billingRunId: string;
  workValueOre: number;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  onClose: () => void;
}

export function VerdictDialog(props: Props) {
  const { billingRunId, workValueOre, onClose } = props;
  const [awardedKr, setAwardedKr] = useState(workValueOre / 100);
  const register = trpc.document.register.useMutation();
  const utils = trpc.useUtils();
  const mut = trpc.billingRun.setVerdict.useMutation({
    onSuccess: async (res) => {
      // Lägg ett faktura-dokument i fil-listan ur den skapade fakturan.
      try {
        await generateFakturaDoc({
          invoice: (res as { invoice: Parameters<typeof generateFakturaDoc>[0]["invoice"] }).invoice,
          matterId: props.matterId,
          meta: {
            matterNumber: props.matterNumber, matterTitle: props.matterTitle,
            ...omitUndefined({
              clientName: props.clientName,
              organizationName: props.organizationName,
              organizationOrgNumber: props.organizationOrgNumber,
            }),
          },
          register, utils: utils as unknown as DocUtils,
        });
      } catch (e) { console.warn("[verdict] faktura-dokument misslyckades:", e); }
      onClose();
    },
  });
  const awardedOre = Math.max(0, Math.round(awardedKr * 100));
  const prutningOre = awardedOre - workValueOre; // ≤ 0
  const tooHigh = awardedOre > workValueOre;

  return (
    <Modal open title="Ange dom" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); if (!tooHigh) mut.mutate({ billingRunId, prutningOre }); }}
        className="space-y-3">
        <p className="text-sm text-gray-600">
          Skriv in det belopp som domen beviljade. Är det lägre än det
          föreslagna räknas mellanskillnaden automatiskt som prutning.
        </p>
        <Pair label="Föreslaget belopp" value={formatCurrency(workValueOre)} />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Dömt belopp (kr)</label>
          <input type="number" min={0} step={1} value={awardedKr}
            onChange={(e) => setAwardedKr(parseFloat(e.target.value) || 0)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
          {tooHigh && (
            <p className="mt-1 text-xs text-red-600">
              Dömt belopp kan inte överstiga föreslaget — kontrollera siffran från domen.
            </p>
          )}
        </div>
        {prutningOre < 0 && !tooHigh && (
          <Pair label="Prutning" value={formatCurrency(prutningOre)} dim />
        )}
        {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={mut.isPending || tooHigh}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {mut.isPending ? "Sparar…" : "Skapa faktura"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Pair({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${dim ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  );
}
