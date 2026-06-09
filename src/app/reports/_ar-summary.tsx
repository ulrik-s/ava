"use client";

/**
 * Kundfordrings-sammanställning (ADR 0007), livstid: brygga (waterfall) +
 * åldersanalys. Konsumerar `reports.arSummary` (WriteOff-baserad konstaterad
 * kundförlust). Fristående komponent så reports/page.tsx hålls hanterbar.
 */

import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
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

type ArData = NonNullable<inferRouterOutputs<AppRouter>["reports"]["arSummary"]>;

export function ArSummarySection({ from, to, userId, lawyerName }: { from: string; to: string; userId?: string; lawyerName?: string }) {
  const q = trpc.reports.arSummary.useQuery({ from, to, ...(userId ? { userId } : {}) });
  const suffix = userId && lawyerName ? ` — andel för ${lawyerName}` : "";

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-900 mb-1">Kundfordringar</h2>
      <p className="text-sm text-gray-500 mb-4">
        Fakturor utställda i perioden{suffix} — fakturerat, inbetalt och konstaterad kundförlust.
      </p>

      {q.isLoading && <p className="text-sm text-gray-500">Laddar…</p>}
      {q.data && <ArSummaryBody data={q.data} />}
    </section>
  );
}

function ArSummaryBody({ data }: { data: ArData }) {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Kundfordrings-brygga */}
        <div>
          <h3 className="text-sm font-medium text-gray-600 mb-2">Brygga</h3>
          <Row label="Fakturerat (brutto)" value={data.bridge.fakturerat} />
          <Row label="− Krediterat / nedsatt" value={-data.bridge.krediterat} />
          <Row label="= Justerat fakturerat" value={data.bridge.justerat} kind="subtotal" />
          <Row label="− Inbetalt" value={-data.bridge.inbetalt} />
          <Row label="− Konstaterad kundförlust" value={-data.bridge.konstateradKundforlust} />
          <Row label="= Utestående fordran" value={data.bridge.utestaende} kind="subtotal" />
          <Row label="varav ej förfallet" value={data.bridge.ejForfallet} kind="sub" />
          <Row label="varav förfallet" value={data.bridge.forfallet} kind="sub" />
          <Row label="Netto realiserat" value={data.bridge.nettoRealiserat} kind="result" />
        </div>

        {/* Åldersanalys */}
        <div>
          <h3 className="text-sm font-medium text-gray-600 mb-2">Åldersanalys (förfallna fakturor)</h3>
          {data.aging.every((b) => b.amount === 0) ? (
            <p className="text-sm text-gray-500">Inga förfallna fakturor.</p>
          ) : (
            data.aging.map((b) => (
              <div key={b.label} className="flex items-center justify-between py-1.5 text-gray-700">
                <span>{b.label}</span>
                <span className="tabular-nums">{formatCurrency(b.amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {data.rows.length > 0 && <ArInvoiceTable rows={data.rows} />}
    </>
  );
}

interface ArRow { id: string; invoiceDate: string; matterNumber: string; title: string; fakturerat: number; inbetalt: number; avskrivet: number; utestaende: number }

function ArInvoiceTable({ rows }: { rows: readonly ArRow[] }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <h3 className="text-sm font-medium text-gray-600 mb-2">Per faktura</h3>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-1.5 font-normal">Fakturadatum</th>
            <th className="py-1.5 font-normal">Ärende</th>
            <th className="py-1.5 font-normal text-right">Fakturerat</th>
            <th className="py-1.5 font-normal text-right">Inbetalt</th>
            <th className="py-1.5 font-normal text-right">Avskrivet</th>
            <th className="py-1.5 font-normal text-right">Utestående</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 whitespace-nowrap font-mono text-xs">{new Date(r.invoiceDate).toLocaleDateString("sv-SE")}</td>
              <td className="py-1.5 text-gray-700">{r.matterNumber}{r.title ? ` — ${r.title}` : ""}</td>
              <td className="py-1.5 text-right font-mono">{formatCurrency(r.fakturerat)}</td>
              <td className="py-1.5 text-right font-mono text-gray-600">{formatCurrency(r.inbetalt)}</td>
              <td className="py-1.5 text-right font-mono text-red-700">{r.avskrivet > 0 ? `−${formatCurrency(r.avskrivet)}` : "—"}</td>
              <td className="py-1.5 text-right font-mono font-medium">{formatCurrency(r.utestaende)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
