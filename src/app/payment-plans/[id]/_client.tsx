"use client";

import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { formatCurrency } from "@/lib/client/utils";
import { ArrowLeft, Ban, Wallet } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktiv",
  COMPLETED: "Slutförd",
  CANCELLED: "Avbruten",
};
const STATUS_PILL: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  COMPLETED: "bg-gray-200 text-gray-700",
  CANCELLED: "bg-red-100 text-red-800",
};

// eslint-disable-next-line complexity
export default function PaymentPlanDetailClient({ id: paramId }: { id: string }) {
  const id = useRouteId() ?? paramId;
  const plan = trpc.paymentPlan.getById.useQuery({ id });
  const utils = trpc.useUtils();
  const cancel = trpc.paymentPlan.cancel.useMutation({
    onSuccess: () => {
      utils.paymentPlan.getById.invalidate({ id });
      utils.paymentPlan.list.invalidate();
    },
  });

  if (plan.isLoading) return <p className="text-gray-500">Laddar…</p>;
  if (plan.error) return <p className="text-red-600">{plan.error.message}</p>;
  if (!plan.data) return null;
  const p = plan.data as PlanDetail;

  const klient = p.invoice?.matter?.contacts?.[0]?.contact?.name ?? "—";

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Link href="/payment-plans" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Avbetalningsplaner
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet size={22} /> Avbetalningsplan
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {p.invoice?.matter?.id ? (
              <EntityLink route="matters" id={p.invoice.matter.id} className="text-blue-600 hover:underline">
                {p.invoice.matter.matterNumber ?? "—"}
              </EntityLink>
            ) : (
              <span>{p.invoice?.matter?.matterNumber ?? "—"}</span>
            )}
            {" · "}{p.invoice?.matter?.title ?? "—"}{" · "}{klient}
          </p>
        </div>
        <span className={`text-xs uppercase font-medium rounded px-2 py-1 ${STATUS_PILL[p.status] ?? "bg-gray-100 text-gray-700"}`}>
          {STATUS_LABEL[p.status] ?? p.status}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-gray-500">Månadsbelopp</dt>
          <dd className="font-mono text-gray-900">{formatCurrency(p.monthlyAmount)}</dd>
          <dt className="text-gray-500">Förfaller</dt>
          <dd className="text-gray-900">Den {p.dayOfMonth}:e varje månad</dd>
          <dt className="text-gray-500">Startdatum</dt>
          <dd className="text-gray-900">{new Date(p.startDate).toLocaleDateString("sv-SE")}</dd>
          <dt className="text-gray-500">Faktura</dt>
          <dd>
            {p.invoice?.id ? (
              <EntityLink route="invoices" id={p.invoice.id} className="text-blue-600 hover:underline">
                {p.invoice.id}
              </EntityLink>
            ) : (
              <span>—</span>
            )}
            {" · "}
            <span className="font-mono">{p.invoice ? formatCurrency(p.invoice.amount) : ""}</span>
          </dd>
          {p.notes && (
            <>
              <dt className="text-gray-500">Anteckningar</dt>
              <dd className="text-gray-900">{p.notes}</dd>
            </>
          )}
        </dl>

        {p.status === "ACTIVE" && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                if (confirm("Avbryta avbetalningsplanen? Fakturan återgår till status SENT.")) {
                  cancel.mutate({ planId: p.id });
                }
              }}
              disabled={cancel.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              <Ban size={14} /> {cancel.isPending ? "Avbryter…" : "Avbryt planen"}
            </button>
          </div>
        )}
      </div>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Inbetalningar</h2>
        {(p.invoice?.payments ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 italic">Inga inbetalningar registrerade än.</p>
        ) : (
          <>
            <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
              {(p.invoice?.payments ?? []).map((pay) => (
                <li key={pay.id} className="px-4 py-2 text-sm flex items-center justify-between">
                  <span className="text-gray-700">
                    {new Date(pay.paidAt).toLocaleDateString("sv-SE")}
                    {pay.note && <span className="ml-2 text-xs text-gray-500">{pay.note}</span>}
                  </span>
                  <span className="font-mono text-gray-900">{formatCurrency(pay.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-gray-500 flex justify-between">
              <span>{(p.invoice?.payments ?? []).length} st inbetalningar</span>
              <span>
                Totalt betalt:{" "}
                <span className="font-mono text-gray-900">
                  {formatCurrency((p.invoice?.payments ?? []).reduce((s, x) => s + x.amount, 0))}
                </span>
                {" av "}
                <span className="font-mono">{p.invoice ? formatCurrency(p.invoice.amount) : ""}</span>
              </span>
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Påminnelser</h2>
        {p.reminders.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Inga påminnelser skickade än.</p>
        ) : (
          <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
            {p.reminders.map((r) => (
              <li key={r.id} className="px-4 py-2 text-sm flex items-center justify-between">
                <span>
                  <span className="font-mono text-gray-700">{r.dueMonth}</span>
                  <span className="ml-2 text-[10px] uppercase rounded bg-gray-100 text-gray-600 px-1.5 py-0.5">{r.type}</span>
                </span>
                <span className="text-xs text-gray-500">
                  Skickad {new Date(r.sentAt).toLocaleString("sv-SE")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface PlanDetail {
  id: string;
  status: string;
  monthlyAmount: number;
  dayOfMonth: number;
  startDate: string | Date;
  notes?: string | null;
  invoice?: {
    id: string;
    amount: number;
    matter?: {
      id: string;
      matterNumber: string;
      title: string;
      contacts?: Array<{ contact?: { id: string; name: string } }>;
    };
    payments?: Array<{
      id: string;
      amount: number;
      paidAt: string | Date;
      note?: string | null;
    }>;
  };
  reminders: Array<{
    id: string;
    dueMonth: string;
    type: string;
    sentAt: string | Date;
  }>;
}
