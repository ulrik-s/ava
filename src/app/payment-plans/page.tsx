"use client";

/**
 * `/payment-plans` — listning av alla avbetalningsplaner i organisationen.
 * Status-flikar + sortbar/justerbar kolumnvy via DataTable.
 */

import { useState } from "react";
import { Wallet, Search } from "lucide-react";
import { trpc } from "@/lib/client/trpc";
import { entityHref } from "@/lib/client/demo/entity-href";
import { formatCurrency } from "@/lib/client/utils";
import { DataTable, type Column } from "@/components/ui/data-table";

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

function paidOf(p: PlanRow): number {
  return (p.invoice?.payments ?? []).reduce((s, x) => s + x.amount, 0);
}

function totalOf(p: PlanRow): number {
  return p.invoice?.amount ?? 0;
}

const planColumns: Column<PlanRow>[] = [
  { key: "matterNumber", label: "Ärendenr", sortable: true,
    sortValue: (p) => p.invoice?.matter?.matterNumber ?? "",
    render: (p) => <span className="text-sm font-medium text-gray-900">{p.invoice?.matter?.matterNumber ?? "—"}</span> },
  { key: "title", label: "Titel", sortable: true,
    sortValue: (p) => p.invoice?.matter?.title ?? "",
    render: (p) => <span className="text-sm text-gray-700">{p.invoice?.matter?.title ?? "—"}</span> },
  { key: "klient", label: "Klient", sortable: true,
    sortValue: (p) => p.invoice?.matter?.contacts?.[0]?.contact?.name ?? "",
    render: (p) => <span className="text-sm text-gray-500">{p.invoice?.matter?.contacts?.[0]?.contact?.name ?? "—"}</span> },
  { key: "status", label: "Status", sortable: true, sortValue: (p) => STATUS_LABEL[p.status],
    render: (p) => (
      <span className={`text-[10px] uppercase font-medium rounded px-1.5 py-0.5 ${STATUS_PILL[p.status]}`}>
        {STATUS_LABEL[p.status]}
      </span>
    ),
  },
  { key: "monthlyAmount", label: "Per månad", sortable: true, align: "right",
    sortValue: (p) => p.monthlyAmount,
    render: (p) => <span className="font-mono text-sm">{formatCurrency(p.monthlyAmount)}</span> },
  { key: "paid", label: "Inbetalt", sortable: true, align: "right",
    sortValue: (p) => paidOf(p),
    render: (p) => <span className="font-mono text-sm">{formatCurrency(paidOf(p))}</span> },
  { key: "total", label: "Totalt", sortable: true, align: "right",
    sortValue: (p) => totalOf(p),
    render: (p) => <span className="font-mono text-sm">{formatCurrency(totalOf(p))}</span> },
  { key: "pct", label: "Andel", sortable: true, align: "right",
    sortValue: (p) => totalOf(p) > 0 ? paidOf(p) / totalOf(p) : 0,
    render: (p) => {
      const total = totalOf(p);
      const pct = total > 0 ? Math.min(100, Math.round((paidOf(p) / total) * 100)) : 0;
      return <span className="text-sm text-gray-700">{pct}%</span>;
    },
  },
];

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

      {list.isLoading ? (
        <p className="text-sm text-gray-500">Laddar…</p>
      ) : (
        <DataTable
          prefKey="list.payment-plans"
          columns={planColumns}
          data={(list.data ?? []) as PlanRow[]}
          rowKey={(p) => p.id}
          emptyMessage={`Inga ${STATUS_LABEL[status].toLowerCase()} planer.`}
          onRowClick={(p) => location.assign(entityHref("payment-plans", p.id))}
        />
      )}
    </div>
  );
}
