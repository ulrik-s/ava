"use client";

/**
 * `BillingDialog` — skapa en BillingRun. Tre kombinerade flöden:
 *   ACCONTO          — clientShareBips + beräknat belopp, advokat kan justera
 *   FINAL            — recipient-val + lista av aconton att dra av
 *   KOSTNADSRAKNING  — bara notes + bekräftelse (väntar på dom efteråt)
 */
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";

interface AccontoRow { id: string; amountOre: number; recipient: string }

interface Props {
  matterId: string;
  type: "ACCONTO" | "FINAL";
  existingAccontos: AccontoRow[];
  onClose: () => void;
}

export function BillingDialog({ matterId, type, existingAccontos, onClose }: Props) {
  return (
    <Modal open title={titleFor(type)} onClose={onClose} widthClass="max-w-xl">
      {type === "ACCONTO" && <AccontoForm matterId={matterId} onDone={onClose} />}
      {type === "FINAL" && <FinalForm matterId={matterId} accontos={existingAccontos} onDone={onClose} />}
    </Modal>
  );
}

function titleFor(type: string): string {
  if (type === "ACCONTO") return "Aconto till klient";
  return "Faktura";
}

function AccontoForm({ matterId, onDone }: { matterId: string; onDone: () => void }) {
  const [clientShareBips, setBips] = useState(2000); // 20% default
  const [amountKr, setAmountKr] = useState(2000);
  const mut = trpc.billingRun.createAcconto.useMutation({ onSuccess: onDone });
  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate({
      matterId, clientShareBips, amountOre: Math.round(amountKr * 100), recipient: "KLIENT",
    }); }} className="space-y-3">
      <p className="text-sm text-gray-600">
        Acconto baseras på klientens självrisk-/avgifts-procentsats × upparbetat värde.
        Justera beloppet vid behov (t.ex. för att runda av).
      </p>
      <Field label="Klientens andel (procent)">
        <input type="number" min={0} max={100} step={1} value={clientShareBips / 100}
          onChange={(e) => setBips(Math.round((parseFloat(e.target.value) || 0) * 100))}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </Field>
      <Field label="Belopp (kr)">
        <input type="number" min={0} step={1} value={amountKr}
          onChange={(e) => setAmountKr(parseFloat(e.target.value) || 0)}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </Field>
      {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
      <SubmitRow onDone={onDone} pending={mut.isPending} label="Skapa aconto-faktura" />
    </form>
  );
}

function FinalForm({ matterId, accontos, onDone }: { matterId: string; accontos: AccontoRow[]; onDone: () => void }) {
  const [recipient, setRecipient] = useState<"KLIENT" | "FORSAKRING" | "RATTSHJALPSMYNDIGHET">("KLIENT");
  const [selected, setSelected] = useState<string[]>(accontos.map((a) => a.id));
  const mut = trpc.billingRun.createFinal.useMutation({ onSuccess: onDone });
  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate({
      matterId, recipient, deductedBillingRunIds: selected,
    }); }} className="space-y-3">
      <p className="text-sm text-gray-600">
        Faktura med full specifikation av tid och utlägg. Alla obetalda
        tids- och utläggsrader fryses.
      </p>
      <Field label="Mottagare">
        <select value={recipient} onChange={(e) => setRecipient(e.target.value as typeof recipient)}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
          <option value="KLIENT">Klient (PRIVAT)</option>
          <option value="FORSAKRING">Försäkringsbolag (rättsskydd)</option>
          <option value="RATTSHJALPSMYNDIGHET">Rättshjälpsmyndighet</option>
        </select>
      </Field>
      {accontos.length > 0 && (
        <Field label="Avdrag (tidigare aconton)">
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {accontos.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(a.id)}
                  onChange={(e) => setSelected((s) => e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id))} />
                <span className="font-mono">{formatCurrency(a.amountOre)}</span>
                <span className="text-gray-500 text-xs">({a.recipient})</span>
              </label>
            ))}
          </div>
        </Field>
      )}
      {mut.error && <p className="text-sm text-red-700">{mut.error.message}</p>}
      <SubmitRow onDone={onDone} pending={mut.isPending} label="Skapa faktura" />
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function SubmitRow({ onDone, pending, label }: { onDone: () => void; pending: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onDone} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
      <button type="submit" disabled={pending} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
        {pending ? "Skapar…" : label}
      </button>
    </div>
  );
}
