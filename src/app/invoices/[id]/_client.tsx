"use client";

/**
 * Fakturadetaljsida — sammanställer header, summering, modals och betalningar.
 * Detaljerad UI är extraherad till _underscore-prefixade child-moduler.
 */

import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { Money } from "@/components/ui/money";
import type { DownloadClient } from "@/lib/client/backend/load-document-blob";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { isDemoTier } from "@/lib/client/firma/firma-config";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import type { AppRouter } from "@/lib/server/routers/_app";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { computeMatterSettlement, computeRadgivningsavgift, type MatterSettlement } from "@/lib/shared/rattshjalp";
import { asId } from "@/lib/shared/schemas/ids";
import { splitVat } from "@/lib/shared/vat";
import { computeInvoiceLedger } from "@/lib/shared/write-off-calc";
import { CreditModal } from "./_credit-modal";
import { DispatchHistory } from "./_dispatch-history";
import { InvoiceActions } from "./_invoice-actions";
import { PaymentModal } from "./_payment-modal";
import { PaymentsTable } from "./_payments-table";
import { PlanModal } from "./_plan-modal";
import { SendInvoiceModal } from "./_send-invoice-modal";
import { WriteOffModal } from "./_write-off-modal";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  PAID: "Betald",
  CANCELLED: "Annullerad",
  BAD_DEBT: "Kundförlust",
  INSTALLMENT_PLAN: "Avbetalningsplan",
};

/** All state + mutationer för fakturadetaljsidan (sätter/öppnar modals, fel). */
function useInvoiceDetail(id: string) {
  const utils = trpc.useUtils();
  const [showPayment, setShowPayment] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showCredit, setShowCredit] = useState(false);
  const [showWriteOff, setShowWriteOff] = useState(false);
  const [showSend, setShowSend] = useState(false);
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
  const writeOff = trpc.invoice.writeOff.useMutation({
    onSuccess: () => { refetchAll(); setShowWriteOff(false); setError(null); },
    onError: (e) => setError(e.message),
  });
  const createCredit = trpc.invoice.createCredit.useMutation({
    onSuccess: () => { refetchAll(); setShowCredit(false); setError(null); },
    onError: (e) => setError(e.message),
  });

  return {
    utils, error, setError,
    show: { payment: showPayment, plan: showPlan, credit: showCredit, writeOff: showWriteOff, send: showSend },
    setShowPayment, setShowPlan, setShowCredit, setShowWriteOff, setShowSend,
    recordPayment, createPlan, cancelPlan, setStatus, writeOff, createCredit,
  };
}
type InvoiceDetailState = ReturnType<typeof useInvoiceDetail>;

type WriteOffRow = Inv["writeOffs"][number];
interface LedgerView {
  paidSum: number; writtenOffSum: number; writeOffs: WriteOffRow[]; outstanding: number;
  accontoDeductions: AccontoDeductionRow[]; accontoDeductionTotal: number; netAmount: number;
}

/** Kundfordrings-ledger (ADR 0007): outstanding = belopp − betalt − krediterat − avskrivet. */
function invoiceLedger(inv: Inv): LedgerView {
  const paidSum = inv.payments.reduce((s: number, p: { amount: number }) => s + p.amount, 0);
  const writeOffs = inv.writeOffs ?? [];
  const writtenOffSum = writeOffs.reduce((s, w) => s + w.amount, 0);
  const creditedSum = Math.abs(creditNoteOf(inv)?.amount ?? 0);
  const { outstanding } = computeInvoiceLedger(inv.amount, paidSum, creditedSum, writtenOffSum);
  const accontoDeductions = accontoDeductionsOf(inv);
  const accontoDeductionTotal = accontoDeductions.reduce((s, d) => s + (d.accontoInvoice?.amount ?? 0), 0);
  return { paidSum, writtenOffSum, writeOffs, outstanding, accontoDeductions, accontoDeductionTotal, netAmount: inv.amount - accontoDeductionTotal };
}

export default function InvoiceDetailClient({ id: paramId }: { id: string }) {
  // Static export: sentinel-shell för nya id:n → läs riktiga id:t ur URL:en.
  const id = asId<"InvoiceId">(useRouteId() ?? paramId);
  const invoice = trpc.invoice.getById.useQuery({ id });
  const s = useInvoiceDetail(id);

  if (invoice.isLoading) return <p className="p-6 text-sm text-gray-400">Laddar…</p>;
  if (invoice.error || !invoice.data) return <p className="p-6 text-sm text-red-600">Kunde inte ladda fakturan.</p>;
  const inv = invoice.data;
  const ledger = invoiceLedger(inv);

  return (
    <div className="space-y-6">
      <InvoiceHeader inv={inv} />
      <InvoiceSummaryCard inv={inv} ledger={ledger} s={s} />
      <InvoiceSections inv={inv} ledger={ledger} onCancelPlan={() => { if (inv.paymentPlan) s.cancelPlan.mutate({ planId: inv.paymentPlan.id }); }} />
      <InvoiceModals inv={inv} ledger={ledger} s={s} />
    </div>
  );
}

/** Vita summerings-kortet: SummaryGrid + åtgärdsknappar + ev. notering. */
function InvoiceSummaryCard({ inv, ledger, s }: { inv: Inv; ledger: LedgerView; s: InvoiceDetailState }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <SummaryGrid
        inv={inv} paidSum={ledger.paidSum} writtenOffSum={ledger.writtenOffSum}
        outstanding={ledger.outstanding} accontoDeductionTotal={ledger.accontoDeductionTotal} netAmount={ledger.netAmount}
      />
      <InvoiceActions
        invoiceType={inv.invoiceType}
        status={inv.status}
        hasPlan={inv.paymentPlan?.status === "ACTIVE"}
        hasCreditNote={!!inv.creditNote}
        outstanding={ledger.outstanding}
        onShowPayment={() => s.setShowPayment(true)}
        onShowPlan={() => s.setShowPlan(true)}
        onShowCredit={() => s.setShowCredit(true)}
        onShowWriteOff={() => s.setShowWriteOff(true)}
        onShowSend={() => s.setShowSend(true)}
        onSetStatus={(status) => s.setStatus.mutate({ invoiceId: inv.id, status: status as Parameters<typeof s.setStatus.mutate>[0]["status"] })}
      />
      {inv.notes && <p className="mt-4 text-sm text-gray-600 border-t pt-3">{inv.notes}</p>}
    </div>
  );
}

/** Sektions-kort under summeringen (spec, dokument, kredit, plan, acconto, betalningar …). */
function InvoiceSections({ inv, ledger, onCancelPlan }: { inv: Inv; ledger: LedgerView; onCancelPlan: () => void }) {
  return (
    <>
      <SpecificationCard timeEntries={inv.timeEntries ?? []} expenses={inv.expenses ?? []} />
      <InvoiceDocumentsCard documents={inv.documents ?? []} />
      <CreditBanners inv={inv} />
      {inv.paymentPlan && <PaymentPlanCard plan={inv.paymentPlan} onCancel={onCancelPlan} />}
      <FinalInvoiceExtras inv={inv} ledger={ledger} />
      <PaymentsTable payments={inv.payments} paidSum={ledger.paidSum} />
      <DispatchHistory invoiceId={inv.id} />
      {ledger.writeOffs.length > 0 && <WriteOffsCard writeOffs={ledger.writeOffs} />}
    </>
  );
}

/** Alla åtgärds-modals (betalning, kredit, plan, avskrivning, skicka). */
function InvoiceModals({ inv, ledger, s }: { inv: Inv; ledger: LedgerView; s: InvoiceDetailState }) {
  return (
    <>
      {s.show.payment && (
        <PaymentModal invoiceId={inv.id} isPending={s.recordPayment.isPending} error={s.error}
          onSubmit={(data) => s.recordPayment.mutate(data)} onClose={() => s.setShowPayment(false)} />
      )}
      {s.show.credit && (
        <CreditModal invoiceId={inv.id} amount={inv.amount} hasActivePlan={inv.paymentPlan?.status === "ACTIVE"}
          isPending={s.createCredit.isPending} error={s.error}
          onSubmit={(data) => s.createCredit.mutate(data)} onClose={() => { s.setShowCredit(false); s.setError(null); }} />
      )}
      {s.show.plan && (
        <PlanModal invoiceId={inv.id} isPending={s.createPlan.isPending} error={s.error}
          onSubmit={(data) => s.createPlan.mutate(data)} onClose={() => s.setShowPlan(false)} />
      )}
      {s.show.writeOff && (
        <WriteOffModal invoiceId={inv.id} outstanding={ledger.outstanding} isPending={s.writeOff.isPending} error={s.error}
          onSubmit={(data) => s.writeOff.mutate(data)} onClose={() => { s.setShowWriteOff(false); s.setError(null); }} />
      )}
      {s.show.send && (
        <SendInvoiceModal
          invoiceId={inv.id}
          invoiceNumber={(inv as { invoiceNumber?: string | null }).invoiceNumber}
          amount={inv.amount}
          ocrReference={(inv as { ocrReference?: string | null }).ocrReference}
          invoiceDate={inv.invoiceDate}
          matterNumber={inv.matter.matterNumber}
          matterTitle={inv.matter.title}
          onRecorded={() => {
            void s.utils.invoiceDispatch.list.invalidate({ invoiceId: inv.id });
            // #392: utskick (auto/manuellt) flippar DRAFT→SENT → ladda om fakturan.
            void s.utils.invoice.getById.invalidate({ id: inv.id });
            void s.utils.invoice.list.invalidate();
          }}
          onClose={() => s.setShowSend(false)}
        />
      )}
    </>
  );
}

function WriteOffsCard({ writeOffs }: { writeOffs: ReadonlyArray<{ amount: number; writtenOffAt?: string | Date; reason?: string | null | undefined }> }) {
  return (
    <div className="bg-white rounded-lg border border-red-200 p-6">
      <h2 className="font-semibold text-red-900 mb-3">Konstaterad kundförlust</h2>
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {writeOffs.map((w, i) => (
            <tr key={i}>
              <td className="py-1.5 whitespace-nowrap text-gray-600">
                {w.writtenOffAt ? new Date(w.writtenOffAt).toLocaleDateString("sv-SE") : "—"}
              </td>
              <td className="py-1.5 text-gray-700">{w.reason ?? "Avskriven"}</td>
              <td className="py-1.5 text-right text-red-700">−<Money ore={w.amount} basis="gross" className="font-mono text-red-700" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Inv = NonNullable<inferRouterOutputs<AppRouter>["invoice"]["getById"]>;

// Boundary-vyer härleds direkt ur router-outputen (`invoice.getById` bär nu
// riktiga branded-typer hela vägen, #562) — inga castar behövs.
type AccontoDeductionRow = Inv["accontoDeductions"][number];
type CreditRefView = Inv["creditNote"];

const accontoDeductionsOf = (inv: Inv): AccontoDeductionRow[] => inv.accontoDeductions ?? [];
const creditNoteOf = (inv: Inv): CreditRefView => inv.creditNote ?? null;
const creditedInvoiceOf = (inv: Inv): CreditRefView => inv.creditedInvoice ?? null;

function InvoiceHeader({ inv }: { inv: Inv }) {
  const heading = inv.invoiceType === "ACCONTO" ? "Acconto-faktura"
    : inv.invoiceType === "FINAL" ? "Slutfaktura"
    : inv.invoiceType === "CREDIT" ? "Kreditfaktura"
    : "Faktura";
  const invoiceNumber = (inv as { invoiceNumber?: string | null }).invoiceNumber;
  const ocrReference = (inv as { ocrReference?: string | null }).ocrReference;
  return (
    <div>
      <EntityLink route="matters" id={inv.matter.id} className="text-sm text-blue-600 hover:underline">← {inv.matter.matterNumber} {inv.matter.title}</EntityLink>
      <h1 className="text-2xl font-bold mt-2">
        {heading}
        {invoiceNumber && <span className="ml-3 text-base font-normal text-gray-700">{invoiceNumber}</span>}
        <span className="ml-3 text-sm font-normal text-gray-500">{new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</span>
      </h1>
      {ocrReference && <p className="text-sm text-gray-500 mt-1">OCR: <span className="font-mono">{ocrReference}</span></p>}
    </div>
  );
}

function SummaryGrid({
  inv,
  paidSum,
  writtenOffSum,
  outstanding,
  accontoDeductionTotal,
  netAmount,
}: {
  inv: Inv;
  paidSum: number;
  writtenOffSum: number;
  outstanding: number;
  accontoDeductionTotal: number;
  netAmount: number;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
      <div><p className="text-xs text-gray-500">Status</p><p className="font-medium">{STATUS_LABELS[inv.status] ?? inv.status}</p></div>
      <div><p className="text-xs text-gray-500">Belopp (brutto)</p><p><Money ore={inv.amount} basis="gross" className="font-mono" /></p></div>
      {inv.invoiceType === "FINAL" && (
        <>
          <div><p className="text-xs text-gray-500">Accontoavdrag</p><p>−<Money ore={accontoDeductionTotal} basis="gross" className="font-mono" /></p></div>
          <div><p className="text-xs text-gray-500">Netto att betala</p><p><Money ore={netAmount} basis="gross" className="font-mono font-semibold" /></p></div>
        </>
      )}
      {inv.dueDate && <div><p className="text-xs text-gray-500">Förfallodatum</p><p>{new Date(inv.dueDate).toLocaleDateString("sv-SE")}</p></div>}
      <div><p className="text-xs text-gray-500">Betalat totalt</p><p><Money ore={paidSum} basis="gross" className="font-mono" /></p></div>
      {writtenOffSum > 0 && (
        <div><p className="text-xs text-gray-500">Avskrivet</p><p className="text-red-700">−<Money ore={writtenOffSum} basis="gross" className="font-mono text-red-700" /></p></div>
      )}
      <div><p className="text-xs text-gray-500">Utestående</p><p><Money ore={outstanding} basis="gross" className="font-mono font-semibold" /></p></div>
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
            {" "}— belopp <Money ore={creditNote.amount} basis="gross" />
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
            {" "}(ursprungligt belopp <Money ore={creditedInvoice.amount} basis="gross" />)
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
            <Money ore={plan.monthlyAmount} basis="gross" />/månad • dag {plan.dayOfMonth} • från {new Date(plan.startDate).toLocaleDateString("sv-SE")}
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

type SpecTimeRow = Inv["timeEntries"][number];
type SpecExpenseRow = Inv["expenses"][number];
type InvoiceDocRow = Inv["documents"][number];

/** Bygg slutfaktura-sammanställningen (#349 C) ur fakturans spec + ledger.
 *  Rådgivningstimmen (rättshjälpstaxa) tas med för rättshjälpsärenden. */
function buildSettlement(inv: Inv, ledger: LedgerView): MatterSettlement {
  const times = inv.timeEntries ?? [];
  const exps = inv.expenses ?? [];
  const arvodeOre = times.reduce((s, t) => s + Math.round((t.minutes / 60) * (t.hourlyRate ?? 0)), 0);
  const utlaggOre = exps.reduce((s, e) => s + e.amount, 0);
  const m = inv.matter as { paymentMethod?: string | null; taxaHasFTax?: boolean | null } | null;
  const radgivningOre = m?.paymentMethod === "RATTSHJALP"
    ? computeRadgivningsavgift({ hasFTax: m.taxaHasFTax ?? true }).beloppExclVatOre
    : 0;
  return computeMatterSettlement({
    arvodeOre, utlaggOre, radgivningOre,
    accontoPaidOre: ledger.accontoDeductionTotal,
    paymentsOre: ledger.paidSum,
  });
}

/** Rader för sammanställningskortet (negativa = avdrag). */
function settlementRows(s: MatterSettlement): Array<{ label: string; ore: number; strong?: boolean }> {
  const rows: Array<{ label: string; ore: number; strong?: boolean }> = [
    { label: "Upparbetat arvode", ore: s.arvodeOre },
    { label: "Utlägg", ore: s.utlaggOre },
  ];
  if (s.prutningOre !== 0) rows.push({ label: "Prutning (domstol)", ore: s.prutningOre });
  rows.push({ label: "Brutto", ore: s.bruttoOre, strong: true });
  if (s.accontoPaidOre !== 0) rows.push({ label: "Avgår betalda acconton", ore: -s.accontoPaidOre });
  rows.push({ label: "Slutfaktura", ore: s.slutfakturaOre, strong: true });
  if (s.paymentsOre !== 0) rows.push({ label: "Avgår inbetalt", ore: -s.paymentsOre });
  if (s.radgivningOre !== 0) {
    rows.push({ label: "Rådgivningstimme (rättshjälpstaxa, separat klientfaktura)", ore: s.radgivningOre });
  }
  rows.push({ label: "Utestående", ore: s.outstandingOre, strong: true });
  return rows;
}

/** FINAL-fakturans extra sektioner: accontoavdrag + ärende-sammanställning (#349). */
function FinalInvoiceExtras({ inv, ledger }: { inv: Inv; ledger: LedgerView }) {
  if (inv.invoiceType !== "FINAL") return null;
  return (
    <>
      {ledger.accontoDeductions.length > 0 && <AccontoDeductions deductions={ledger.accontoDeductions} />}
      <SettlementSummaryCard settlement={buildSettlement(inv, ledger)} />
    </>
  );
}

/** Slutfaktura-sammanställning (#349 C): hela ärendets belopp + betalningar. */
function SettlementSummaryCard({ settlement }: { settlement: MatterSettlement }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-900 mb-1">Sammanställning</h2>
      <p className="text-sm text-gray-500 mb-4">Hela ärendets belopp och betalningar.</p>
      <dl className="divide-y divide-gray-100">
        {settlementRows(settlement).map((r) => (
          <div key={r.label} className="flex items-center justify-between py-1.5">
            <dt className={r.strong ? "text-sm font-semibold text-gray-900" : "text-sm text-gray-600"}>{r.label}</dt>
            <dd className={`text-sm ${r.strong ? "font-semibold text-gray-900" : "text-gray-700"}`}><Money ore={r.ore} basis="gross" className="font-mono" /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Öppna ett fakturadokument (PDF m.fl.) i en ny flik — SAMMA flöde som
 * dokumentraden på ärende-sidan ([[_document-row]]): runtime-genererade docs
 * öppnas ur blob-cachen, seed-docs hämtas från GH Pages, self-hosted ur FSA.
 * Tidigare länkade namnet felaktigt till /matters → man dirigerades in i
 * ärendet istället för att få upp filen.
 */
async function openInvoiceDoc(doc: InvoiceDocRow, client: DownloadClient): Promise<void> {
  const { openDocument } = await import("@/lib/client/firma/open-document");
  const { loadHandle } = await import("@/lib/client/fsa/handle-store");
  const { readFromFsa } = await import("@/lib/client/fsa/read-from-fsa");
  const { loadDocumentBlob } = await import("@/lib/client/backend/load-document-blob");
  await openDocument({
    doc: { id: doc.id, ...(doc.storagePath != null ? { storagePath: doc.storagePath } : {}), fileName: doc.fileName },
    // RUNTIME-tier, inte NEXT_PUBLIC_DEMO_BUILD (sant även i lokala self-hosted-
    // builden → länkade fakturadokument till GH Pages = 404). #844.
    isDemo: isDemoTier(),
    ...omitUndefined({ demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO }),
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    // Server-first (#518): hämta bytes från servern (+ klient-cache) i st.f. FSA.
    fetchBlob: () => loadDocumentBlob(client, { id: doc.id, storagePath: doc.storagePath ?? null, fileName: doc.fileName }),
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => alert(m),
  });
}

function InvoiceDocumentsCard({ documents }: { documents: InvoiceDocRow[] }) {
  const utils = trpc.useUtils();
  if (documents.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="font-semibold mb-3">Fakturadokument</h2>
      <ul className="text-sm divide-y divide-gray-100">
        {documents.map((d) => (
          <li key={d.id} className="py-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void openInvoiceDoc(d, utils.client)}
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
  // Utlägg lagras netto (#782) → räkna fram brutto (inkl moms) för det fakturerade.
  const expenseInclOf = (e: SpecExpenseRow) =>
    splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? false }).inclVat;
  const timeTotal = timeEntries.reduce((s, t) => s + lineFor(t), 0);
  const expenseTotal = expenses.reduce((s, e) => s + expenseInclOf(e), 0);
  // Arvode lagras exkl. moms; alla fakturor lägger på 25 % moms på arvodet (#782).
  const arvodeMomsOre = arvodeInclVatOre(timeTotal) - timeTotal;
  const summaUnderlag = arvodeInclVatOre(timeTotal) + expenseTotal;
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
                  <td className="py-1.5 text-right"><Money ore={t.hourlyRate ?? 0} basis="net" className="font-mono" /></td>
                  <td className="py-1.5 text-right"><Money ore={lineFor(t)} basis="net" className="font-mono" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Moms på arvodet (25 %)</span>
            <span className="font-mono">{formatCurrency(arvodeMomsOre)}</span>
          </div>
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
                  <td className="py-1.5 text-right"><Money ore={expenseInclOf(e)} basis="gross" className="font-mono" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t pt-2 flex justify-between text-sm font-semibold">
        <span>Summa underlag</span>
        <Money ore={summaUnderlag} basis="gross" className="font-mono" />
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
          {deductions.map((d: AccontoDeductionRow) => d.accontoInvoice && (
            <tr key={d.id}>
              <td className="py-2">
                <EntityLink route="invoices" id={d.accontoInvoice.id} className="text-blue-600 hover:underline">
                  Acconto {new Date(d.accontoInvoice.invoiceDate).toLocaleDateString("sv-SE")}
                </EntityLink>
              </td>
              <td className="py-2 text-right">−<Money ore={d.accontoInvoice.amount} basis="gross" className="font-mono" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
