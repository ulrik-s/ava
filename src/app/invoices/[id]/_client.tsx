"use client";

/**
 * Fakturadetaljsida — sammanställer header, summering, modals och betalningar.
 * Detaljerad UI är extraherad till _underscore-prefixade child-moduler.
 */

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/client/trpc";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { formatCurrency } from "@/lib/client/utils";
import type { AppRouter } from "@/lib/server/routers/_app";
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
    void utils.invoice.getById.invalidate({ id });
    void utils.invoice.list.invalidate();
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

  const paidSum = inv.payments.reduce((s: number, p: { amount: number }) => s + p.amount, 0);
  const accontoDeductions = accontoDeductionsOf(inv);
  const accontoDeductionTotal = accontoDeductions.reduce(
    (s: number, d: AccontoDeductionRow) => s + d.accontoInvoice.amount,
    0,
  );
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

      <SpecificationCard timeEntries={(inv.timeEntries ?? []) as unknown as SpecTimeRow[]} expenses={(inv.expenses ?? []) as unknown as SpecExpenseRow[]} />

      <InvoiceDocumentsCard documents={(inv.documents ?? []) as unknown as InvoiceDocRow[]} />

      <CreditBanners inv={inv} />

      {inv.paymentPlan && (
        <PaymentPlanCard plan={inv.paymentPlan} onCancel={() => cancelPlan.mutate({ planId: inv.paymentPlan!.id })} />
      )}

      {inv.invoiceType === "FINAL" && accontoDeductions.length > 0 && (
        <AccontoDeductions deductions={accontoDeductions} />
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

// ── Boundary-vyer för join-fält (router-read returnerar `unknown`/`{}` på
//    relationer; vi narrowar dem till de former UI:t faktiskt läser). ──
type AccontoDeductionRow = {
  id: string;
  accontoInvoice: { id: string; invoiceDate: string | Date; amount: number };
};
type CreditRefView = { id: string; invoiceDate: string | Date; amount: number } | null;

const accontoDeductionsOf = (inv: Inv): AccontoDeductionRow[] =>
  (inv.accontoDeductions ?? []) as unknown as AccontoDeductionRow[];
const creditNoteOf = (inv: Inv): CreditRefView =>
  (inv.creditNote ?? null) as unknown as CreditRefView;
const creditedInvoiceOf = (inv: Inv): CreditRefView =>
  (inv.creditedInvoice ?? null) as unknown as CreditRefView;

function InvoiceHeader({ inv }: { inv: Inv }) {
  const heading = inv.invoiceType === "ACCONTO" ? "Acconto-faktura"
    : inv.invoiceType === "FINAL" ? "Slutfaktura"
    : inv.invoiceType === "CREDIT" ? "Kreditfaktura"
    : "Faktura";
  return (
    <div>
      <EntityLink route="matters" id={inv.matter.id} className="text-sm text-blue-600 hover:underline">← {inv.matter.matterNumber} {inv.matter.title}</EntityLink>
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
  const creditNote = creditNoteOf(inv);
  const creditedInvoice = creditedInvoiceOf(inv);
  return (
    <>
      {creditNote && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-orange-900">Denna faktura är krediterad.</p>
          <p className="text-orange-800 mt-1">
            <EntityLink route="invoices" id={creditNote.id} className="underline">
              Kreditfaktura {new Date(creditNote.invoiceDate).toLocaleDateString("sv-SE")}
            </EntityLink>
            {" "}— belopp {formatCurrency(creditNote.amount)}
          </p>
        </div>
      )}
      {inv.invoiceType === "CREDIT" && creditedInvoice && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-orange-900">Detta är en kreditfaktura.</p>
          <p className="text-orange-800 mt-1">
            Krediterar{" "}
            <EntityLink route="invoices" id={creditedInvoice.id} className="underline">
              faktura från {new Date(creditedInvoice.invoiceDate).toLocaleDateString("sv-SE")}
            </EntityLink>
            {" "}(ursprungligt belopp {formatCurrency(creditedInvoice.amount)})
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
            {plan.reminders.map((r: { id: string; type: string; dueMonth: string; sentAt: string | Date }) => (
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

type SpecTimeRow = { id: string; date: string | Date; description: string; minutes: number; hourlyRate?: number | null };
type SpecExpenseRow = { id: string; date: string | Date; description: string; amount: number };
type InvoiceDocRow = { id: string; fileName: string; documentType?: string | null; createdAt?: string | Date | null; storagePath?: string | null; mimeType?: string | null };

/**
 * Öppna ett fakturadokument (PDF m.fl.) i en ny flik — SAMMA flöde som
 * dokumentraden på ärende-sidan ([[_document-row]]): runtime-genererade docs
 * öppnas ur blob-cachen, seed-docs hämtas från GH Pages, self-hosted ur FSA.
 * Tidigare länkade namnet felaktigt till /matters → man dirigerades in i
 * ärendet istället för att få upp filen.
 */
async function openInvoiceDoc(doc: InvoiceDocRow): Promise<void> {
  const { openDocument } = await import("@/lib/client/firma/open-document");
  const { loadHandle } = await import("@/lib/client/fsa/handle-store");
  const { readFromFsa } = await import("@/lib/client/fsa/read-from-fsa");
  await openDocument({
    doc: { id: doc.id, ...(doc.storagePath != null ? { storagePath: doc.storagePath } : {}), fileName: doc.fileName },
    isDemo: process.env.NEXT_PUBLIC_DEMO_BUILD === "1",
    ...(process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO !== undefined ? { demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO } : {}),
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => alert(m),
  });
}

function InvoiceDocumentsCard({ documents }: { documents: InvoiceDocRow[] }) {
  if (documents.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Fakturadokument</h2>
      <ul className="text-sm divide-y divide-gray-100">
        {documents.map((d) => (
          <li key={d.id} className="py-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void openInvoiceDoc(d)}
              className="text-blue-600 hover:underline text-left"
            >
              {d.fileName}
            </button>
            {d.documentType && <span className="text-[10px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{d.documentType}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpecificationCard({ timeEntries, expenses }: { timeEntries: SpecTimeRow[]; expenses: SpecExpenseRow[] }) {
  if (timeEntries.length === 0 && expenses.length === 0) return null;
  const lineFor = (t: SpecTimeRow) => Math.round((t.minutes / 60) * (t.hourlyRate ?? 0));
  const timeTotal = timeEntries.reduce((s, t) => s + lineFor(t), 0);
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Underlag (specifikation)</h2>
      {timeEntries.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Arbetad tid</p>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1 font-normal">Datum</th>
                <th className="py-1 font-normal">Beskrivning</th>
                <th className="py-1 font-normal text-right">Tid</th>
                <th className="py-1 font-normal text-right">Timpris</th>
                <th className="py-1 font-normal text-right">Belopp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {timeEntries.map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5 whitespace-nowrap">{new Date(t.date).toLocaleDateString("sv-SE")}</td>
                  <td className="py-1.5">{t.description}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{(t.minutes / 60).toFixed(1)} h</td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(t.hourlyRate ?? 0)}</td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(lineFor(t))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {expenses.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Utlägg</p>
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="py-1.5 whitespace-nowrap">{new Date(e.date).toLocaleDateString("sv-SE")}</td>
                  <td className="py-1.5">{e.description}</td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t pt-2 flex justify-between text-sm font-semibold">
        <span>Summa underlag</span>
        <span className="font-mono">{formatCurrency(timeTotal + expenseTotal)}</span>
      </div>
    </div>
  );
}

function AccontoDeductions({ deductions }: { deductions: AccontoDeductionRow[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Accontoavdrag</h2>
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {deductions.map((d: AccontoDeductionRow) => (
            <tr key={d.id}>
              <td className="py-2">
                <EntityLink route="invoices" id={d.accontoInvoice.id} className="text-blue-600 hover:underline">
                  Acconto {new Date(d.accontoInvoice.invoiceDate).toLocaleDateString("sv-SE")}
                </EntityLink>
              </td>
              <td className="py-2 text-right font-mono">−{formatCurrency(d.accontoInvoice.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
