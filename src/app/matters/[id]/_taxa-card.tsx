"use client";

/**
 * `TaxaCard` — live-kalkylator för brottmålstaxa enligt DVFS 2025:6.
 *
 * Visas på matter-detaljen om `isTaxeArende=true`. Användaren matar in:
 *   - Nivå (1-4, beroende på vad ärendet inkluderar)
 *   - Sammanlagd förhandlingstid (HUF) i minuter
 *   - F-skatt-flagga
 *
 * Vi sparar inputs via `matter.update` så advokaten ser samma sak nästa
 * gång. Beräkningen körs lokalt mot `computeBrottmalstaxa` — ingen
 * server-roundtrip behövs för att se belopp.
 */

import { useEffect, useState } from "react";
import { Calculator, Info, AlertTriangle, FileText } from "lucide-react";
import { trpc } from "@/client/lib/trpc";
import {
  computeBrottmalstaxa,
  TAXA_MAX_MINUTES,
  type TaxaLevel,
} from "@/shared/brottmalstaxa";
import { formatCurrency } from "@/client/lib/utils";
import { KostnadsrakningModal } from "./_kostnadsrakning-modal";

interface Props {
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  clientName: string;
  courtName?: string;
  defenderName: string;
  defenderEmail?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  initial: {
    taxaLevel?: TaxaLevel | null;
    taxaHuvudforhandlingMin?: number | null;
    taxaHasFTax?: boolean | null;
  };
}

const LEVEL_LABELS: Record<TaxaLevel, string> = {
  1: "Nivå 1 — Grundersättning (bara HUF)",
  2: "Nivå 2 — HUF + häktningsförh. / kvarstad / beslag / reseförbud",
  3: "Nivå 3 — HUF + RPU (rättspsykiatrisk undersökning)",
  4: "Nivå 4 — HUF + häktning m.m. + RPU",
};

// eslint-disable-next-line complexity
export function TaxaCard(props: Props) {
  const { matterId, initial } = props;
  const utils = trpc.useUtils();
  const [level, setLevel] = useState<TaxaLevel>((initial.taxaLevel as TaxaLevel | undefined) ?? 1);
  const [huf, setHuf] = useState<number>(initial.taxaHuvudforhandlingMin ?? 0);
  const [hasFTax, setHasFTax] = useState<boolean>(initial.taxaHasFTax ?? true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const expenses = trpc.expense.list.useQuery({ matterId });

  const update = trpc.matter.update.useMutation({
    onSuccess: () => utils.matter.getById.invalidate({ id: matterId }),
  });

  // Persistera när användaren slutat ändra (300 ms debounce)
  useEffect(() => {
    const t = setTimeout(() => {
      setSaving(true);
      update.mutate(
        { id: matterId, taxaLevel: level, taxaHuvudforhandlingMin: huf, taxaHasFTax: hasFTax },
        { onSettled: () => setSaving(false) },
      );
    }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, huf, hasFTax]);

  const result = computeBrottmalstaxa({ huvudforhandlingMinutes: huf, level, hasFTax });
  const moms = Math.round(result.ersattningExclVat * 0.25);
  const inclMoms = result.ersattningExclVat + moms;

  return (
    <div className="bg-white rounded-lg border border-indigo-200 p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calculator size={18} className="text-indigo-600" />
            Brottmålstaxa — beräkning
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Enligt Domstolsverkets föreskrifter <a className="text-blue-600 hover:underline"
              href="https://www.domstol.se/globalassets/filer/gemensamt-innehall/for-professionella-aktorer/dvfs/2025/dvfs_2025-6.pdf"
              target="_blank" rel="noopener noreferrer">DVFS 2025:6</a> (gäller fr.o.m. 2026-01-01).
          </p>
        </div>
        {saving && <span className="text-xs text-gray-400">Sparar…</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <label className="block md:col-span-3">
          <span className="text-xs text-gray-700 mb-1 block">Ersättningsnivå</span>
          <select
            value={level}
            onChange={(e) => setLevel(Number(e.target.value) as TaxaLevel)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{LEVEL_LABELS[n as TaxaLevel]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-700 mb-1 block">
            HUF-tid (minuter)
            <span className="text-gray-400"> · max {TAXA_MAX_MINUTES}</span>
          </span>
          <input
            type="number" min={0} value={huf || ""}
            onChange={(e) => setHuf(parseInt(e.target.value || "0", 10))}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
          />
          <span className="text-xs text-gray-500 mt-0.5 block">
            {huf > 0 && `${Math.floor(huf / 60)} tim ${huf % 60} min`}
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-gray-700 mb-1 block">F-skatt</span>
          <div className="flex items-center gap-3 mt-2">
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={hasFTax} onChange={() => setHasFTax(true)} />
              Ja
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={!hasFTax} onChange={() => setHasFTax(false)} />
              Nej (× 1237/1626)
            </label>
          </div>
        </label>
        <div className="md:col-span-1">
          <span className="text-xs text-gray-700 mb-1 block">Intervall (tabell)</span>
          <div className="text-sm font-medium text-gray-900 py-1.5">
            {result.intervalLabel || "—"}
          </div>
        </div>
      </div>

      {result.kind === "taxa-applies" && (
        <div className="bg-indigo-50 border border-indigo-200 rounded p-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-700">Taxa-ersättning (exkl moms)</span>
            <span className="font-mono text-gray-900 text-right">{formatCurrency(result.ersattningExclVat)}</span>
            <span className="text-gray-700">+ Moms 25 %</span>
            <span className="font-mono text-gray-700 text-right">{formatCurrency(moms)}</span>
            <span className="text-gray-900 font-medium">= Att fakturera staten</span>
            <span className="font-mono text-gray-900 text-right font-medium">{formatCurrency(inclMoms)}</span>
            <span className="text-gray-500 text-xs col-span-2 pt-2 border-t border-indigo-100">
              <Info size={11} className="inline mr-1" />
              Gränsvärde för att kunna frångå taxan: <strong>{formatCurrency(result.gransvardeExclVat)}</strong> ex moms.
              Om skälig ersättning för faktiskt arbete överstiger detta får domstolen frångå taxan.
            </span>
          </div>
        </div>
      )}

      {result.kind === "exceeds-max" && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-900">
          <AlertTriangle size={14} className="inline mr-1" />
          <strong>Taxan tillämpas inte</strong> — förhandlingstiden ({huf} min) överstiger
          taxans maxgräns ({TAXA_MAX_MINUTES} min = 3 tim 45 min).
          Ersättningen beräknas då som <strong>timkostnadsnorm × faktisk tid</strong>
          (1 626 kr/h ex moms 2026 med F-skatt).
        </div>
      )}

      {result.kind === "invalid-input" && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800">
          Ange en giltig nivå (1-4) och HUF-tid (≥ 0).
        </div>
      )}

      {result.notes.length > 0 && result.kind === "taxa-applies" && (
        <ul className="mt-3 text-xs text-gray-500 space-y-1">
          {result.notes.map((n, i) => <li key={i}>· {n}</li>)}
        </ul>
      )}

      <div className="mt-5 pt-4 border-t border-indigo-100 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          När ordföranden ber om kostnadsräkningen — ett klick öppnar
          stoppa-uret + genererar PDF + öppnar mail.
        </p>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-5 py-3 bg-red-600 text-white font-semibold rounded-lg shadow hover:bg-red-700 active:scale-95"
        >
          <FileText size={16} /> Kostnadsräkning till rätten
        </button>
      </div>

      {showModal && (
        <KostnadsrakningModal
          matterId={matterId}
          matterNumber={props.matterNumber}
          matterTitle={props.matterTitle}
          clientName={props.clientName}
          courtName={props.courtName}
          defenderName={props.defenderName}
          defenderEmail={props.defenderEmail}
          organizationName={props.organizationName}
          organizationOrgNumber={props.organizationOrgNumber}
          expenses={(expenses.data?.expenses ?? []) as ReadonlyArray<{
            id: string; date: string | Date; description: string;
            amount: number; vatRate?: number; vatIncluded?: boolean; billable?: boolean;
          }>}
          initialLevel={level}
          initialHasFTax={hasFTax}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
