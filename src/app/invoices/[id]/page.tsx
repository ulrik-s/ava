"use client";

/**
 * Fakturadetaljsida:
 *   - header med typ, status, belopp, förfallodatum
 *   - lista över registrerade betalningar + summa
 *   - avbetalningsplan (om finns): schema, reminder-logg, avbryt-knapp
 *   - avdragsrader (FINAL): visade acconto-fakturor
 *   - actions: registrera betalning, skapa plan, ändra status (SENT/CANCELLED/BAD_DEBT)
 */

import { use, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  PAID: "Betald",
  CANCELLED: "Annullerad",
  BAD_DEBT: "Kundförlust",
  INSTALLMENT_PLAN: "Avbetalningsplan",
};

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const invoice = trpc.invoice.getById.useQuery({ id });
  const utils = trpc.useUtils();

  const [showPayment, setShowPayment] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [paymentAmountSek, setPaymentAmountSek] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentNote, setPaymentNote] = useState("");

  const [planMonthlySek, setPlanMonthlySek] = useState("");
  const [planDayOfMonth, setPlanDayOfMonth] = useState("1");
  const [planStart, setPlanStart] = useState(new Date().toISOString().slice(0, 10));
  const [planNotes, setPlanNotes] = useState("");

  const [error, setError] = useState<string | null>(null);

  const refetchAll = () => {
    utils.invoice.getById.invalidate({ id });
    utils.invoice.list.invalidate();
  };

  const recordPayment = trpc.invoice.recordPayment.useMutation({
    onSuccess: () => { refetchAll(); setShowPayment(false); setError(null); setPaymentAmountSek(""); setPaymentNote(""); },
    onError: (e) => setError(e.message),
  });
  const createPlan = trpc.invoice.createPaymentPlan.useMutation({
    onSuccess: () => { refetchAll(); setShowPlan(false); setError(null); setPlanMonthlySek(""); setPlanNotes(""); },
    onError: (e) => setError(e.message),
  });
  const cancelPlan = trpc.invoice.cancelPaymentPlan.useMutation({ onSuccess: refetchAll });
  const setStatus = trpc.invoice.setStatus.useMutation({ onSuccess: refetchAll });

  if (invoice.isLoading) return <p className="p-6 text-sm text-gray-400">Laddar…</p>;
  if (invoice.error || !invoice.data) return <p className="p-6 text-sm text-red-600">Kunde inte ladda fakturan.</p>;
  const inv = invoice.data;

  const paidSum = inv.payments.reduce((s, p) => s + p.amount, 0);
  const accontoDeductionTotal = inv.accontoDeductions.reduce((s, d) => s + d.accontoInvoice.amount, 0);
  const netAmount = inv.amount - accontoDeductionTotal;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/matters/${inv.matter.id}`} className="text-sm text-blue-600 hover:underline">← {inv.matter.matterNumber} {inv.matter.title}</Link>
        <h1 className="text-2xl font-bold mt-2">
          {inv.invoiceType === "ACCONTO" ? "Acconto-faktura" : inv.invoiceType === "FINAL" ? "Slutfaktura" : "Faktura"}
          <span className="ml-3 text-sm font-normal text-gray-500">{new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</span>
        </h1>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
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

        <div className="mt-5 flex gap-2 flex-wrap">
          {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
            <button onClick={() => setShowPayment(true)} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
              Registrera betalning
            </button>
          )}
          {inv.status === "SENT" && !inv.paymentPlan && (
            <button onClick={() => setShowPlan(true)} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
              Skapa avbetalningsplan
            </button>
          )}
          {inv.status === "DRAFT" && (
            <button onClick={() => setStatus.mutate({ invoiceId: inv.id, status: "SENT" })} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
              Markera som skickad
            </button>
          )}
          {inv.status === "SENT" && !inv.paymentPlan && (
            <>
              <button onClick={() => setStatus.mutate({ invoiceId: inv.id, status: "CANCELLED" })} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
                Annullera
              </button>
              <button onClick={() => setStatus.mutate({ invoiceId: inv.id, status: "BAD_DEBT" })} className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded hover:bg-red-50">
                Skriv av som kundförlust
              </button>
            </>
          )}
        </div>
        {inv.notes && <p className="mt-4 text-sm text-gray-600 border-t pt-3">{inv.notes}</p>}
      </div>

      {/* Avbetalningsplan */}
      {inv.paymentPlan && (
        <div className="bg-white rounded-lg border border-indigo-200 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-indigo-900">Avbetalningsplan</h2>
              <p className="text-sm text-gray-600 mt-1">
                {formatCurrency(inv.paymentPlan.monthlyAmount)}/månad • dag {inv.paymentPlan.dayOfMonth} • från {new Date(inv.paymentPlan.startDate).toLocaleDateString("sv-SE")}
              </p>
              <p className="text-xs text-gray-500 mt-1">Status: {inv.paymentPlan.status}</p>
              {inv.paymentPlan.notes && <p className="text-xs text-gray-500 mt-1">{inv.paymentPlan.notes}</p>}
            </div>
            {inv.paymentPlan.status === "ACTIVE" && (
              <button onClick={() => cancelPlan.mutate({ planId: inv.paymentPlan!.id })} className="text-xs text-red-600 hover:underline">
                Avbryt planen
              </button>
            )}
          </div>

          {inv.paymentPlan.reminders.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs font-medium mb-2">Utskick</p>
              <ul className="text-xs text-gray-600 space-y-1">
                {inv.paymentPlan.reminders.map((r) => (
                  <li key={r.id}>
                    {r.type === "DUE" ? "📅" : "⚠️"} {r.dueMonth} — {r.type === "DUE" ? "Månadspåminnelse" : "Förseningspåminnelse"} skickat {new Date(r.sentAt).toLocaleString("sv-SE")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Avdragsrader (FINAL) */}
      {inv.invoiceType === "FINAL" && inv.accontoDeductions.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold mb-3">Accontoavdrag</h2>
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {inv.accontoDeductions.map((d) => (
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
      )}

      {/* Betalningar */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-3">Betalningar</h2>
        {inv.payments.length === 0 ? (
          <p className="text-sm text-gray-500">Inga betalningar registrerade.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="text-left pb-2">Datum</th>
                <th className="text-left pb-2">Registrerad av</th>
                <th className="text-left pb-2">Notering</th>
                <th className="text-right pb-2">Belopp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inv.payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">{new Date(p.paidAt).toLocaleDateString("sv-SE")}</td>
                  <td className="py-2 text-gray-600">{p.recordedBy.name}</td>
                  <td className="py-2 text-gray-600">{p.note ?? "—"}</td>
                  <td className="py-2 text-right font-mono">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td colSpan={3} className="pt-3">Totalt betalat</td>
                <td className="pt-3 text-right font-mono">{formatCurrency(paidSum)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Registrera betalning */}
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold mb-4">Registrera betalning</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Belopp (kr)</label>
                <input type="number" min={1} value={paymentAmountSek} onChange={(e) => setPaymentAmountSek(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Betalningsdatum</label>
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Notering</label>
                <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowPayment(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
              <button
                disabled={!paymentAmountSek || recordPayment.isPending}
                onClick={() => recordPayment.mutate({
                  invoiceId: inv.id,
                  amount: Math.round(Number(paymentAmountSek) * 100),
                  paidAt: paymentDate,
                  note: paymentNote || undefined,
                })}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {recordPayment.isPending ? "Sparar…" : "Spara"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Skapa plan */}
      {showPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold mb-4">Skapa avbetalningsplan</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Månadsbelopp (kr)</label>
                <input type="number" min={1} value={planMonthlySek} onChange={(e) => setPlanMonthlySek(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Förfallodag i månaden (1-28)</label>
                <input type="number" min={1} max={28} value={planDayOfMonth} onChange={(e) => setPlanDayOfMonth(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Startdatum</label>
                <input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Notering</label>
                <textarea value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowPlan(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
              <button
                disabled={!planMonthlySek || createPlan.isPending}
                onClick={() => createPlan.mutate({
                  invoiceId: inv.id,
                  monthlyAmount: Math.round(Number(planMonthlySek) * 100),
                  dayOfMonth: Number(planDayOfMonth),
                  startDate: planStart,
                  notes: planNotes || undefined,
                })}
                className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {createPlan.isPending ? "Skapar…" : "Skapa plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
