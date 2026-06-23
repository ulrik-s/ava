"use client";

/**
 * Utskickshistorik per faktura (#178) — kanal-agnostisk vy av avsikt + status.
 * Visar alla utskicksförsök (manuella #179 + server-medierade #180) oavsett tier.
 * Read-only här; köning/sändning sker via `invoiceDispatch.queue`/`updateStatus`.
 */

import { trpc } from "@/lib/client/trpc";
import type { InvoiceId } from "@/lib/shared/schemas/ids";

const CHANNEL_LABEL: Record<string, string> = {
  email: "E-post",
  efaktura: "E-faktura",
  kivra: "Kivra",
  print: "Brev",
  manual: "Manuellt",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Köad",
  sent: "Skickad",
  delivered: "Levererad",
  failed: "Misslyckad",
};

function statusClass(status: string): string {
  switch (status) {
    case "delivered": return "bg-green-100 text-green-700";
    case "sent": return "bg-blue-100 text-blue-700";
    case "failed": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

interface DispatchRow {
  id: string;
  channel: string;
  recipient: string;
  status: string;
  queuedAt: Date | string;
  error?: string | null;
}

export function DispatchHistory({ invoiceId }: { invoiceId: InvoiceId }) {
  const dispatches = trpc.invoiceDispatch.list.useQuery({ invoiceId });
  const rows = (dispatches.data ?? []) as DispatchRow[];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Utskick</h2>
      {dispatches.isLoading ? (
        <p className="text-sm text-gray-400">Laddar…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Inga utskick registrerade.</p>
      ) : (
        <ul className="divide-y divide-gray-100 -my-1.5">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0">
                <p className="text-sm text-gray-900">
                  {CHANNEL_LABEL[d.channel] ?? d.channel} → <span className="font-mono text-xs">{d.recipient}</span>
                </p>
                <p className="text-[10px] text-gray-400">
                  {new Date(d.queuedAt).toLocaleString("sv-SE")}
                  {d.error ? ` — ${d.error}` : ""}
                </p>
              </div>
              <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium shrink-0 ${statusClass(d.status)}`}>
                {STATUS_LABEL[d.status] ?? d.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
