"use client";

/**
 * Fakturadetaljsida — sammanställer header, summering, modals och betalningar.
 * Detaljerad UI är extraherad till _underscore-prefixade child-moduler.
 */

import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/client/lib/trpc";
import { useRouteId } from "@/client/lib/demo/use-route-id";
import { formatCurrency } from "@/client/lib/utils";
import type { AppRouter } from "@/server/routers/_app";
import { PaymentModal } from "./_payment-modal";
import { PlanModal } from "./_plan-modal";
import { CreditModal } from "./_credit-modal";
import { InvoiceActions } from "./_invoice-actions";
import { PaymentsTable } from "./_payments-table";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  PAID: "Betald",
  CANCELLED: "Annullerad",
  BAD_DEBT: "Kundförlust",
  INSTALLMENT_PLAN: "Avbetalningsplan",
};

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'InvoiceDetailClient' has a complexity of 14. Maximum allowed is 8.)
export default function InvoiceDetailClient({ id: paramId }: { id: string }) {
  // Static export: sentinel-shell för nya id:n → läs riktiga id:t ur URL:en.
  const id = useRouteId() ?? paramId;
  const invoice = trpc.invoice.getById.useQuery({ id });
  const utils = trpc.useUtils();

  const [showPayment, setShowPayment] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showCredit, setShowCredit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetchAll = () => {
    utils.invoice.getById.invalidate({ id });
    utils.invoice.list.invalidate();
  };

  const recordPayment = trpc.invoice.recordPayment.useMutation({
    onSuccess: () => { refetchAll(); setShowPayment(false); setError(null); },
    onError: (e) => setError(e.message),
  });
  const createPlan = trpc.invoice.createPaymentPlan.useMutation({
    onSuccess: () => { refetchAll(); setShowPlan(false); setError(null); },
    onError: (e) => setError(e.message),
  });
  const cancelPlan = trpc.invoice.cancelPaymentPlan.useMutation({ onSuccess: refetchAll });
  const setStatus = trpc.invoice.setStatus.useMutation({ onSuccess: refetchAll });
  const createCredit = trpc.invoice.createCredit.useMutation({
    onSuccess: () => { refetchAll(); setShowCredit(false); setError(null); },
    onError: (e) => setError(e.message),
  });

  if (invoice.isLoading) return <p className="p-6 text-sm text-gray-400">Laddar…</p>;
  if (invoice.error || !invoice.data) return <p className="p-6 text-sm text-red-600">Kunde inte ladda fakturan.</p>;
  const inv = invoice.data;

  const paidSum = inv.payments.reduce((s, p) => s + p.amount, 0);
  const accontoDeductionTotal = inv.accontoDeductions.reduce((s, d) => s + d.accontoInvoice.amount, 0);
  const netAmount = inv.amount - accontoDeductionTotal;

  return (
    <div className="space-y-6">
      <InvoiceHeader inv={inv} />

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <SummaryGrid
          inv={inv}
          paidSum={paidSum}
          accontoDeductionTotal={accontoDeductionTotal}
          netAmount={netAmount}
        />
        <InvoiceActions
          invoiceType={inv.invoiceType}
          status={inv.status}
          hasPlan={inv.paymentPlan?.status === "ACTIVE"}
          hasCreditNote={!!inv.creditNote}
          onShowPayment={() => setShowPayment(true)}
          onShowPlan={() => setShowPlan(true)}
          onShowCredit={() => setShowCredit(true)}
          onSetStatus={(status) => setStatus.mutate({ invoiceId: inv.id, status: status as Parameters<typeof setStatus.mutate>[0]["status"] })}
        />
        {inv.notes && <p className="mt-4 text-sm text-gray-600 border-t pt-3">{inv.notes}</p>}
      </div>

      <CreditBanners inv={inv} />

      {inv.paymentPlan && (
        <PaymentPlanCard plan={inv.paymentPlan} onCancel={() => cancelPlan.mutate({ planId: inv.paymentPlan!.id })} />
      )}

      {inv.invoiceType === "FINAL" && inv.accontoDeductions.length > 0 && (
        <AccontoDeductions deductions={inv.accontoDeductions} />
      )}

      <PaymentsTable payments={inv.payments} paidSum={paidSum} />

      {showPayment && (
        <PaymentModal
          invoiceId={inv.id}
          isPending={recordPayment.isPending}
          error={error}
          onSubmit={(data) => recordPayment.mutate(data)}
          onClose={() => setShowPayment(false)}
        />
      )}

      {showCredit && (
        <CreditModal
          invoiceId={inv.id}
          amount={inv.amount}
          hasActivePlan={inv.paymentPlan?.status === "ACTIVE"}
          isPending={createCredit.isPending}
          error={error}
          onSubmit={(data) => createCredit.mutate(data)}
          onClose={() => { setShowCredit(false); setError(null); }}
        />
      )}

      {showPlan && (
        <PlanModal
          invoiceId={inv.id}
          isPending={createPlan.isPending}
          error={error}
          onSubmit={(data) => createPlan.mutate(data)}
          onClose={() => setShowPlan(false)}
        />
      )}
    </div>
  );
}

type Inv = NonNullable<inferRouterOutputs<AppRouter>["invoice"]["getById"]>;

function InvoiceHeader({ inv }: { inv: Inv }) {
  const heading = inv.invoiceType === "ACCONTO" ? "Acconto-faktura"
    : inv.invoiceType === "FINAL" ? "Slutfaktura"
    : inv.invoiceType === "CREDIT" ? "Kreditfaktura"
    : "Faktura";
  return (
    <div>
      <Link href={`/matters/${inv.matter.id}`} className="text-sm text-blue-600 hover:underline">← {inv.matter.matterNumber} {inv.matter.title}</Link>
      <h1 className="text-2xl font-bold mt-2">
        {heading}
        <span className="ml-3 text-sm font-normal text-gray-500">{new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</span>
      </h1>
    </div>
  );
}

function SummaryGrid({
  inv,
  paidSum,
  accontoDeductionTotal,
  netAmount,
}: {
  inv: Inv;
  paidSum: number;
  accontoDeductionTotal: number;
  netAmount: number;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
      <div><p className="text-xs text-gray-500">Status</p><p className="font-medium">{STATUS_LABELS[inv.status] ?? inv.status}</p></div>
      <div><p className="text-xs text-gray-500">Belopp (brutto)</p><p className="font-mono">{formatCurrency(inv.amount)}</p></div>
      {inv.invoiceType === "FINAL" && (
        <>
          <div><p className="text-xs text-gray-500">Accontoavdrag</p><p className="font-mono">−{formatCurrency(accontoDeductionTotal)}</p></div>
          <div><p className="text-xs text-gray-500">Netto att betala</p><p className="font-mono font-semibold">{formatCurrency(netAmount)}</p></div>
        </>
      )}
      {inv.dueDate && <div><p className="text-xs text-gray-500">Förfallodatum</p><p>{new Date(inv.dueDate).toLocaleDateString("sv-SE")}</p></div>}
      <div><p className="text-xs text-gray-500">Betalat totalt</p><p className="font-mono">{formatCurrency(paidSum)}</p></div>
    </div>
  );
}

function CreditBanners({ inv }: { inv: Inv }) {
  return (
    <>
      {inv.creditNote && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-orange-900">Denna faktura är krediterad.</p>
          <p className="text-orange-800 mt-1">
            <Link href={`/invoices/${inv.creditNote.id}`} className="underline">
              Kreditfaktura {new Date(inv.creditNote.invoiceDate).toLocaleDateString("sv-SE")}
            </Link>
            {" "}— belopp {formatCurrency(inv.creditNote.amount)}
          </p>
        </div>
      )}
      {inv.invoiceType === "CREDIT" && inv.creditedInvoice && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-orange-900">Detta är en kreditfaktura.</p>
          <p className="text-orange-800 mt-1">
            Krediterar{" "}
            <Link href={`/invoices/${inv.creditedInvoice.id}`} className="underline">
              faktura från {new Date(inv.creditedInvoice.invoiceDate).toLocaleDateString("sv-SE")}
            </Link>
            {" "}(ursprungligt belopp {formatCurrency(inv.creditedInvoice.amount)})
          </p>
        </div>
      )}
    </>
  );
}

function PaymentPlanCard({
  plan,
  onCancel,
}: {
  plan: NonNullable<Inv["paymentPlan"]>;
  onCancel: () => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-indigo-200 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-indigo-900">Avbetalningsplan</h2>
          <p className="text-sm text-gray-600 mt-1">
            {formatCurrency(plan.monthlyAmount)}/månad • dag {plan.dayOfMonth} • från {new Date(plan.startDate).toLocaleDateString("sv-SE")}
          </p>
          <p className="text-xs text-gray-500 mt-1">Status: {plan.status}</p>
          {plan.notes && <p className="text-xs text-gray-500 mt-1">{plan.notes}</p>}
        </div>
        {plan.status === "ACTIVE" && (
          <button onClick={onCancel} className="text-xs text-red-600 hover:underline">
            Avbryt planen
          </button>
        )}
      </div>

      {plan.reminders.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <p className="text-xs font-medium mb-2">Utskick</p>
          <ul className="text-xs text-gray-600 space-y-1">
            {plan.reminders.map((r) => (
              <li key={r.id}>
                {r.type === "DUE" ? "📅" : "⚠️"} {r.dueMonth} — {r.type === "DUE" ? "Månadspåminnelse" : "Förseningspåminnelse"} skickat {new Date(r.sentAt).toLocaleString("sv-SE")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AccontoDeductions({ deductions }: { deductions: Inv["accontoDeductions"] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Accontoavdrag</h2>
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {deductions.map((d) => (
            <tr key={d.id}>
              <td className="py-2">
                <Link href={`/invoices/${d.accontoInvoice.id}`} className="text-blue-600 hover:underline">
                  Acconto {new Date(d.accontoInvoice.invoiceDate).toLocaleDateString("sv-SE")}
                </Link>
              </td>
              <td className="py-2 text-right font-mono">−{formatCurrency(d.accontoInvoice.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
