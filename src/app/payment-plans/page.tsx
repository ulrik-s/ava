"use client";

/**
 * `/payment-plans` — listning av alla avbetalningsplaner i organisationen.
 *
 * Tidigare gick alla planer bara att hitta via Faktura-detaljvyn. Nu får
 * de en egen sida med status-flikar (ACTIVE / COMPLETED / CANCELLED) och
 * snabb-sök på klient/ärendenr/anteckning.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Wallet, Search } from "lucide-react";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";

type Status = "ACTIVE" | "COMPLETED" | "CANCELLED";

const STATUS_LABEL: Record<Status, string> = {
  ACTIVE: "Aktiva",
  COMPLETED: "Slutförda",
  CANCELLED: "Avbrutna",
};
const STATUS_PILL: Record<Status, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  COMPLETED: "bg-gray-200 text-gray-700",
  CANCELLED: "bg-red-100 text-red-800",
};

export default function PaymentPlansPage() {
  const [status, setStatus] = useState<Status>("ACTIVE");
  const [search, setSearch] = useState("");
  const list = trpc.paymentPlan.list.useQuery({ status, search: search || undefined });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Wallet size={22} /> Avbetalningsplaner
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Alla planer i organisationen. Klicka för detaljer + påminnelse-historik.
        </p>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="inline-flex rounded-md border border-gray-200 bg-white text-xs">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`px-3 py-1.5 ${status === s ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 text-gray-400" size={14} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök på klient eller ärendenr…"
            className="pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-72"
          />
        </div>
      </div>

      {list.isLoading && <p className="text-sm text-gray-500">Laddar…</p>}
      {list.data && list.data.length === 0 && (
        <div className="bg-white border border-dashed border-gray-200 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500">
            Inga {STATUS_LABEL[status].toLowerCase()} planer.
          </p>
        </div>
      )}

      <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
        {/* eslint-disable-next-line complexity */}
        {list.data?.map((p: PlanRow) => {
          const klient = p.invoice?.matter?.contacts?.[0]?.contact?.name ?? "—";
          const matterNr = p.invoice?.matter?.matterNumber ?? "—";
          const matterTitle = p.invoice?.matter?.title ?? "—";
          const paid = (p.invoice?.payments ?? []).reduce((s, x) => s + x.amount, 0);
          const total = p.invoice?.amount ?? 0;
          const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
          return (
            <li key={p.id}>
              <Link
                href={`/payment-plans/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{matterNr}</span>
                    <span className="text-xs text-gray-500 truncate">{matterTitle}</span>
                    <span className={`ml-2 text-[10px] uppercase font-medium rounded px-1.5 py-0.5 ${STATUS_PILL[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {klient} · {formatCurrency(p.monthlyAmount)}/mån · {formatCurrency(paid)} av {formatCurrency(total)} ({pct}%)
                  </p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface PlanRow {
  id: string;
  status: Status;
  monthlyAmount: number;
  dayOfMonth: number;
  invoice?: {
    amount?: number;
    payments?: Array<{ amount: number }>;
    matter?: {
      matterNumber?: string;
      title?: string;
      contacts?: Array<{ contact?: { id: string; name: string } }>;
    };
  };
}
