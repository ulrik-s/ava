"use client";

/**
 * Kundfordrings-sammanställning (ADR 0007), livstid: brygga (waterfall) +
 * åldersanalys. Konsumerar `reports.arSummary` (WriteOff-baserad konstaterad
 * kundförlust). Fristående komponent så reports/page.tsx hålls hanterbar.
 */

import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";

function Row({ label, value, kind = "normal" }: { label: string; value: number; kind?: "normal" | "subtotal" | "result" | "sub" }) {
  const cls =
    kind === "result" ? "font-semibold text-gray-900 border-t-2 border-gray-300"
    : kind === "subtotal" ? "font-medium text-gray-800 border-t border-gray-200"
    : kind === "sub" ? "text-gray-500 text-sm"
    : "text-gray-700";
  return (
    <div className={`flex items-center justify-between py-1.5 ${cls}`}>
      <span className={kind === "sub" ? "pl-4" : ""}>{label}</span>
      <span className="tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}

export function ArSummarySection() {
  const q = trpc.reports.arSummary.useQuery();

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-900 mb-1">Kundfordringar</h2>
      <p className="text-sm text-gray-500 mb-4">Livstid — fakturerat, inbetalt och konstaterad kundförlust.</p>

      {q.isLoading && <p className="text-sm text-gray-500">Laddar…</p>}
      {q.data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Kundfordrings-brygga */}
          <div>
            <h3 className="text-sm font-medium text-gray-600 mb-2">Brygga</h3>
            <Row label="Fakturerat (brutto)" value={q.data.bridge.fakturerat} />
            <Row label="− Krediterat / nedsatt" value={-q.data.bridge.krediterat} />
            <Row label="= Justerat fakturerat" value={q.data.bridge.justerat} kind="subtotal" />
            <Row label="− Inbetalt" value={-q.data.bridge.inbetalt} />
            <Row label="− Konstaterad kundförlust" value={-q.data.bridge.konstateradKundforlust} />
            <Row label="= Utestående fordran" value={q.data.bridge.utestaende} kind="subtotal" />
            <Row label="varav ej förfallet" value={q.data.bridge.ejForfallet} kind="sub" />
            <Row label="varav förfallet" value={q.data.bridge.forfallet} kind="sub" />
            <Row label="Netto realiserat" value={q.data.bridge.nettoRealiserat} kind="result" />
          </div>

          {/* Åldersanalys */}
          <div>
            <h3 className="text-sm font-medium text-gray-600 mb-2">Åldersanalys (förfallna fakturor)</h3>
            {q.data.aging.every((b) => b.amount === 0) ? (
              <p className="text-sm text-gray-500">Inga förfallna fakturor.</p>
            ) : (
              q.data.aging.map((b) => (
                <div key={b.label} className="flex items-center justify-between py-1.5 text-gray-700">
                  <span>{b.label}</span>
                  <span className="tabular-nums">{formatCurrency(b.amount)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
