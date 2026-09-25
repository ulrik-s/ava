"use client";

/**
 * Förväntade domstolsbetalningar utan faktura (#173) på ärende-sidan.
 *
 * Registrera en kostnadsräkning som väntar på utbetalning (Domstolsverket),
 * och pricka av faktiskt utbetalt belopp (3b-ii: begärt är memo, utbetalt bokas).
 * Målnumret (matchningsnyckel, #175) redigeras i ärendehuvudet (#1134).
 */

import { useId, useState } from "react";
import { Money } from "@/components/ui/money";
import { sectionHeaderClass } from "@/components/ui/section-tone";
import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";

interface Receivable {
  id: string;
  description: string;
  expectedAmount: number;
  status: string;
  settledAmount?: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Väntar",
  SETTLED: "Mottagen",
  CANCELLED: "Avbruten",
};

/** Formulär för att registrera en ny förväntad domstolsbetalning. */
function AddReceivableForm({ matterId, onAdded }: { matterId: MatterId; onAdded: () => void }) {
  const descId = useId();
  const amtId = useId();
  const [desc, setDesc] = useState("");
  const [kr, setKr] = useState("");
  const create = trpc.expectedReceivable.create.useMutation({
    onSuccess: () => { setDesc(""); setKr(""); onAdded(); },
  });
  const submit = () =>
    create.mutate({ matterId, description: desc, expectedAmount: Math.round(Number(kr) * 100) });
  return (
    <div className="border-t pt-3 mt-3 space-y-2">
      <input value={desc} onChange={(e) => setDesc(e.target.value)} aria-labelledby={descId}
        placeholder="Kostnadsräkning t.ex. Svea HovR mål B 1234-26"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
      <div className="flex gap-2">
        <input value={kr} onChange={(e) => setKr(e.target.value)} type="text" inputMode="decimal" aria-labelledby={amtId}
          placeholder="Begärt belopp (kr)"
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <button onClick={submit} disabled={create.isPending || !desc || !kr}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          Lägg till fordran
        </button>
      </div>
    </div>
  );
}

/** En fordran-rad med avprickning (markera mottagen) / avbryt. */
function ReceivableRow({ r, onChanged }: { r: Receivable; onChanged: () => void }) {
  const [kr, setKr] = useState("");
  const settle = trpc.expectedReceivable.settle.useMutation({ onSuccess: onChanged });
  const cancel = trpc.expectedReceivable.cancel.useMutation({ onSuccess: onChanged });
  return (
    <li className="py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-800">{r.description}</span>
        <span className="text-xs rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{STATUS_LABEL[r.status] ?? r.status}</span>
      </div>
      <div className="text-xs text-gray-500 mt-0.5">
        Begärt: <Money ore={r.expectedAmount} basis="gross" className="font-mono" />
        {r.status === "SETTLED" && r.settledAmount != null && (
          <> · Mottaget: <Money ore={r.settledAmount} basis="gross" className="font-mono text-green-700" /></>
        )}
      </div>
      {r.status === "PENDING" && (
        <div className="flex gap-2 mt-1.5">
          <input value={kr} onChange={(e) => setKr(e.target.value)} type="text" inputMode="decimal" placeholder="Utbetalt (kr)"
            className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
          <button onClick={() => settle.mutate({ id: r.id, settledAmount: Math.round(Number(kr) * 100) })}
            disabled={settle.isPending || !kr}
            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
            Markera mottagen
          </button>
          <button onClick={() => cancel.mutate({ id: r.id })} disabled={cancel.isPending}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">
            Avbryt
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Panelen är bara relevant i ärenden där DOMSTOLEN betalar dig utan AVA-faktura
 * (förordnat: offentlig försvarare / taxeärende). I andra ärenden — privat
 * betalning, rättsskydd, vanlig tvist mot privat klient — betalar inte domstolen
 * dig, så panelen är bara förvirrande och döljs. Säkerhetsnät: redan registrerade
 * fordringar visas alltid (annars går de inte att se/pricka av/avbryta).
 */
export function ExpectedReceivablesSection({ matterId, isCourtMatter }: { matterId: MatterId; isCourtMatter: boolean }) {
  const list = trpc.expectedReceivable.list.useQuery({ matterId });
  const utils = trpc.useUtils();
  const refetch = () => void utils.expectedReceivable.list.invalidate({ matterId });
  const rows = (list.data ?? []) as Receivable[];
  if (!isCourtMatter && rows.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className={sectionHeaderClass("green")}>
        <h2 className="font-semibold text-gray-900">Domstolsbetalningar (utan faktura)</h2>
      </div>
      <div className="p-6">
      <p className="text-xs text-gray-500 mb-3">
        Kostnadsräkningar som domstolen betalar. Begärt belopp är ett memo — det
        domstolen faktiskt betalar bokas vid avprickning.
      </p>
      {rows.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => <ReceivableRow key={r.id} r={r} onChanged={refetch} />)}
        </ul>
      ) : (
        <p className="text-xs text-gray-400">Inga registrerade ännu.</p>
      )}
      <AddReceivableForm matterId={matterId} onAdded={refetch} />
      </div>
    </div>
  );
}
