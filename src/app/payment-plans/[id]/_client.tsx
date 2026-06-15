"use client";

import { ArrowLeft, Ban, Wallet } from "lucide-react";
import Link from "next/link";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { computeInvoiceLedger } from "@/lib/shared/write-off-calc";

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

export default function PaymentPlanDetailClient({ id: paramId }: { id: string }) {
  const id = useRouteId() ?? paramId;
  const plan = trpc.paymentPlan.getById.useQuery({ id });
  const utils = trpc.useUtils();
  const cancel = trpc.paymentPlan.cancel.useMutation({
    onSuccess: () => {
      void utils.paymentPlan.getById.invalidate({ id });
      void utils.paymentPlan.list.invalidate();
    },
  });

  if (plan.isLoading) return <p className="text-gray-500">Laddar…</p>;
  if (plan.error) return <p className="text-red-600">{plan.error.message}</p>;
  if (!plan.data) return null;
  const p = plan.data as PlanDetail;

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Link href="/payment-plans" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Avbetalningsplaner
        </Link>
      </div>

      <PlanHeader p={p} />
      <PlanSummaryCard p={p} onCancel={() => cancel.mutate({ planId: p.id })} cancelling={cancel.isPending} />
      <PaymentsSection invoice={p.invoice} />
      <RemindersSection reminders={p.reminders} />
    </div>
  );
}

type PlanMatter = NonNullable<NonNullable<PlanDetail["invoice"]>["matter"]>;

function klientName(m: PlanMatter | undefined): string {
  return m?.contacts?.[0]?.contact?.name ?? "—";
}

function statusPillView(status: string): { label: string; cls: string } {
  return {
    label: STATUS_LABEL[status] ?? status,
    cls: STATUS_PILL[status] ?? "bg-gray-100 text-gray-700",
  };
}

/** Ärende-referensen: länk om ärende-id finns, annars enbart numret. */
function MatterRef({ m }: { m: PlanMatter | undefined }) {
  const number = m?.matterNumber ?? "—";
  if (m?.id) {
    return (
      <EntityLink route="matters" id={m.id} className="text-blue-600 hover:underline">
        {number}
      </EntityLink>
    );
  }
  return <span>{number}</span>;
}

/** Rubrik: titel, länk till ärende/klient och status-pill. */
function PlanHeader({ p }: { p: PlanDetail }) {
  const m = p.invoice?.matter;
  const pill = statusPillView(p.status);
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Wallet size={22} /> Avbetalningsplan
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          <MatterRef m={m} />
          {" · "}{m?.title ?? "—"}{" · "}{klientName(m)}
        </p>
      </div>
      <span className={`text-xs uppercase font-medium rounded px-2 py-1 ${pill.cls}`}>
        {pill.label}
      </span>
    </div>
  );
}

/** Plan-detaljer (belopp, förfallodag, faktura) + avbryt-knapp för aktiv plan. */
function PlanSummaryCard({ p, onCancel, cancelling }: { p: PlanDetail; onCancel: () => void; cancelling: boolean }) {
  return (
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
              if (confirm("Avbryta avbetalningsplanen? Fakturan återgår till status SENT.")) onCancel();
            }}
            disabled={cancelling}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            <Ban size={14} /> {cancelling ? "Avbryter…" : "Avbryt planen"}
          </button>
        </div>
      )}
    </div>
  );
}

type PlanInvoice = NonNullable<PlanDetail["invoice"]>;

/** Inbetalningar mot fakturan: lista, summa och utestående saldo. */
function PaymentsSection({ invoice }: { invoice: PlanDetail["invoice"] }) {
  const payments = invoice?.payments ?? [];
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Inbetalningar</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-gray-500 italic">Inga inbetalningar registrerade än.</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
            {payments.map((pay) => (
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
            <span>{payments.length} st inbetalningar</span>
            <span>
              Totalt betalt:{" "}
              <span className="font-mono text-gray-900">
                {formatCurrency(payments.reduce((s, x) => s + x.amount, 0))}
              </span>
              {" av "}
              <span className="font-mono">{invoice ? formatCurrency(invoice.amount) : ""}</span>
            </span>
          </div>
          {invoice && <OutstandingRow invoice={invoice} payments={payments} />}
        </>
      )}
    </section>
  );
}

/** Utestående-raden: faktura-belopp minus betalningar och ev. avskrivningar. */
function OutstandingRow({ invoice, payments }: { invoice: PlanInvoice; payments: NonNullable<PlanInvoice["payments"]> }) {
  const paid = payments.reduce((s, x) => s + x.amount, 0);
  const writtenOff = ((invoice as { writeOffs?: Array<{ amount: number }> }).writeOffs ?? []).reduce((s, w) => s + w.amount, 0);
  const { outstanding } = computeInvoiceLedger(invoice.amount, paid, 0, writtenOff);
  return (
    <div className="mt-1 text-xs flex justify-end gap-1">
      <span className="text-gray-500">Utestående:</span>
      <span className="font-mono font-semibold text-gray-900">{formatCurrency(outstanding)}</span>
    </div>
  );
}

/** Skickade påminnelser för planen. */
function RemindersSection({ reminders }: { reminders: PlanDetail["reminders"] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Påminnelser</h2>
      {reminders.length === 0 ? (
        <p className="text-sm text-gray-500 italic">Inga påminnelser skickade än.</p>
      ) : (
        <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
          {reminders.map((r) => (
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
