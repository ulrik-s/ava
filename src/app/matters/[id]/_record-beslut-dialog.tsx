"use client";

/**
 * Registrera domstolens beslut (#828): dömt belopp (kr) + ev. prutning (kr).
 * Används för både tingsrättens första beslut och hovrättens (slutgiltiga) —
 * servern väljer rätt övergång ur KR:ns nuvarande status.
 *
 * Utbruten ur fakturapanelen (#1929) när den flyttades till `useTRPC`.
 */

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Modal } from "@/components/ui/modal";
import { useTRPC } from "@/lib/client/trpc";
import type { BillingRunId } from "@/lib/shared/schemas/ids";

export function RecordBeslutDialog({ billingRunId, onClose, onDone }: { billingRunId: BillingRunId; onClose: () => void; onDone: () => void }) {
  const [awardedKr, setAwardedKr] = useState<number | null>(null);
  const [prutningKr, setPrutningKr] = useState<number | null>(null);
  const record = useMutation(useTRPC().billingRun.recordKostnadsrakningBeslut.mutationOptions({
    onSuccess: () => { onDone(); onClose(); },
  }));
  const submit = (): void => {
    record.mutate({
      billingRunId,
      awardedOre: Math.round((awardedKr ?? 0) * 100),
      ...(prutningKr != null ? { prutningOre: -Math.abs(Math.round(prutningKr * 100)) } : {}),
    });
  };
  return (
    <Modal open title="Registrera domstolens beslut" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <p className="text-sm text-gray-600">Ange det belopp domstolen dömde (och ev. prutning). Fakturan skapas i ett separat steg.</p>
        <label className="block text-xs font-medium">Dömt belopp (kr)
          <DecimalInput value={awardedKr} onChange={setAwardedKr} placeholder="Skriv in belopp"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </label>
        <label className="block text-xs font-medium">Prutning (kr, valfritt)
          <DecimalInput value={prutningKr} onChange={setPrutningKr} placeholder="0"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </label>
        {record.error && <p className="text-sm text-red-700">{record.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={record.isPending} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {record.isPending ? "Sparar…" : "Spara beslut"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
