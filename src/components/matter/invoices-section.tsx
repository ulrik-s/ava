"use client";

/**
 * Fakturablock på matter-sidan:
 *   - lista alla fakturor på ärendet med typ/status/belopp
 *   - knappar: "Skapa acconto" + "Skapa slutfaktura"
 *   - modal för ACCONTO (belopp, förfallodatum, notes)
 *   - modal för FINAL (välj time entries, expenses, acconto-avdrag)
 *
 * Detaljer (betalningar, avbetalningsplan) hanteras på /invoices/[id].
 */

import { useId, useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { DataTable, type Column } from "@/components/ui/data-table";

interface InvoiceRow {
  id: string;
  invoiceDate: string | Date;
  invoiceType: string;
  status: string;
  amount: number;
}

const BADGE_BASE = "text-[10px] rounded-full px-2 py-0.5 font-medium";
/** Faktura-typ vinner över status (acconto/slut/kredit får egen färg). */
const TYPE_BADGE: Record<string, string> = {
  ACCONTO: "bg-purple-100 text-purple-700",
  FINAL: "bg-blue-100 text-blue-700",
  CREDIT: "bg-orange-100 text-orange-700",
};
const STATUS_BADGE: Record<string, string> = {
  PAID: "bg-green-100 text-green-700",
  SENT: "bg-amber-100 text-amber-700",
  INSTALLMENT_PLAN: "bg-indigo-100 text-indigo-700",
  CANCELLED: "bg-gray-200 text-gray-600",
  BAD_DEBT: "bg-red-100 text-red-700",
};

/** Badge-klass för en faktura: typ-färg först, annars status-färg, annars grå.
 *  Uppslag i st.f. if/switch-kedja (håller under complexity@8). Exporterad för test. */
export function statusBadge(status: string, invoiceType: string): string {
  const color = TYPE_BADGE[invoiceType] ?? STATUS_BADGE[status] ?? "bg-gray-100 text-gray-600";
  return `${BADGE_BASE} ${color}`;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "Utkast",
    SENT: "Skickad",
    PAID: "Betald",
    CANCELLED: "Annullerad",
    BAD_DEBT: "Kundförlust",
    INSTALLMENT_PLAN: "Avbetalningsplan",
  };
  return map[status] ?? status;
}

function typeLabel(t: string): string {
  return t === "ACCONTO" ? "Acconto"
    : t === "FINAL" ? "Slutfaktura"
    : t === "CREDIT" ? "Kreditfaktura"
    : "Faktura";
}

const invoiceCols: Column<InvoiceRow>[] = [
  { key: "invoiceDate", label: "Datum", sortable: true, sortValue: (i) => new Date(i.invoiceDate),
    render: (i) => <span>{new Date(i.invoiceDate).toLocaleDateString("sv-SE")}</span> },
  { key: "type", label: "Typ", sortable: true, sortValue: (i) => typeLabel(i.invoiceType),
    render: (i) => <span>{typeLabel(i.invoiceType)}</span> },
  { key: "status", label: "Status", sortable: true, sortValue: (i) => statusLabel(i.status),
    render: (i) => <span className={statusBadge(i.status, i.invoiceType)}>{statusLabel(i.status)}</span> },
  { key: "amount", label: "Belopp", sortable: true, align: "right", sortValue: (i) => i.amount,
    render: (i) => <span className="font-mono">{formatCurrency(i.amount)}</span> },
  { key: "open", label: "", sortable: false, align: "right", hideable: false,
    render: (i) => <EntityLink route="invoices" id={i.id} className="text-blue-600 hover:underline text-xs">Öppna</EntityLink> },
];

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'InvoicesSection' har JSX-conditionals)
export function InvoicesSection({ matterId }: { matterId: string }) {
  const invoices = trpc.invoice.list.useQuery({ matterId });
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId });
  const expenses = trpc.expense.list.useQuery({ matterId });
  const utils = trpc.useUtils();

  const [showAcconto, setShowAcconto] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accontoAmountId = useId();
  const accontoDueDateId = useId();
  const accontoNotesId = useId();
  const finalDueDateId = useId();
  const finalNotesId = useId();

  const createAcconto = trpc.invoice.createAcconto.useMutation({
    onSuccess: () => {
      void utils.invoice.list.invalidate({ matterId });
      setShowAcconto(false);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const createFinal = trpc.invoice.createFinal.useMutation({
    onSuccess: () => {
      void utils.invoice.list.invalidate({ matterId });
      void utils.timeEntry.list.invalidate({ matterId });
      void utils.expense.list.invalidate({ matterId });
      setShowFinal(false);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  // Acconto-form state
  const [accontoAmountSek, setAccontoAmountSek] = useState("");
  const [accontoDueDate, setAccontoDueDate] = useState("");
  const [accontoNotes, setAccontoNotes] = useState("");

  // Final-form state
  const [selectedTimeIds, setSelectedTimeIds] = useState<string[]>([]);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [selectedAccontoIds, setSelectedAccontoIds] = useState<string[]>([]);
  const [finalDueDate, setFinalDueDate] = useState("");
  const [finalNotes, setFinalNotes] = useState("");

  const toggle = (list: string[], id: string, setter: (v: string[]) => void) =>
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const unbilled = {
    timeEntries: timeEntries.data?.entries.filter((t) => !t.invoiceId) ?? [],
    expenses: expenses.data?.expenses.filter((e) => !e.invoiceId) ?? [],
  };
  const availableAccontos = (invoices.data ?? []).filter((i) => {
    const deductedOnFinals = i.deductedOnFinals as unknown as { id: string }[] | undefined;
    return i.invoiceType === "ACCONTO" && deductedOnFinals?.length === 0 && i.status !== "CANCELLED";
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Fakturor</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowAcconto(true); setError(null); }}
            className="px-3 py-1.5 text-sm border border-purple-200 bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
          >
            + Acconto
          </button>
          <button
            onClick={() => { setShowFinal(true); setError(null); }}
            className="px-3 py-1.5 text-sm border border-blue-200 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            + Slutfaktura
          </button>
        </div>
      </div>

      {invoices.isLoading ? (
        <p className="p-6 text-sm text-gray-400">Laddar…</p>
      ) : (
        <div className="p-4">
          <DataTable
            prefKey={`list.matter-invoices.${matterId}`}
            columns={invoiceCols}
            data={(invoices.data ?? []) as InvoiceRow[]}
            rowKey={(i) => i.id}
            emptyMessage="Inga fakturor ännu."
          />
        </div>
      )}

      {/* ACCONTO modal */}
      {showAcconto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold mb-4">Ny acconto-faktura</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor={accontoAmountId} className="block text-xs font-medium mb-1">Belopp (kr)</label>
                <input
                  id={accontoAmountId}
                  type="number" min={1}
                  value={accontoAmountSek}
                  onChange={(e) => setAccontoAmountSek(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor={accontoDueDateId} className="block text-xs font-medium mb-1">Förfallodatum</label>
                <input
                  id={accontoDueDateId}
                  type="date"
                  value={accontoDueDate}
                  onChange={(e) => setAccontoDueDate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor={accontoNotesId} className="block text-xs font-medium mb-1">Notering (valfri)</label>
                <textarea
                  id={accontoNotesId}
                  value={accontoNotes}
                  onChange={(e) => setAccontoNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowAcconto(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
              <button
                disabled={!accontoAmountSek || createAcconto.isPending}
                onClick={() =>
                  createAcconto.mutate({
                    matterId,
                    amount: Math.round(Number(accontoAmountSek) * 100),
                    dueDate: accontoDueDate || undefined,
                    notes: accontoNotes || undefined,
                  })
                }
                className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {createAcconto.isPending ? "Skapar…" : "Skapa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FINAL modal */}
      {showFinal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold mb-4">Skapa slutfaktura</h3>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium mb-1">Tidsposter att fakturera</p>
                {unbilled.timeEntries.length === 0 ? (
                  <p className="text-xs text-gray-400">Inga ofakturerade tidsposter.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
                    {unbilled.timeEntries.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTimeIds.includes(t.id)}
                          onChange={() => toggle(selectedTimeIds, t.id, setSelectedTimeIds)}
                          className="accent-blue-600"
                        />
                        <span className="flex-1 truncate">{new Date(t.date).toLocaleDateString("sv-SE")} — {t.description}</span>
                        <span className="text-gray-500">{(t.minutes / 60).toFixed(1)}h</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium mb-1">Utlägg</p>
                {unbilled.expenses.length === 0 ? (
                  <p className="text-xs text-gray-400">Inga ofakturerade utlägg.</p>
                ) : (
                  <div className="max-h-32 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
                    {unbilled.expenses.map((e) => (
                      <label key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedExpenseIds.includes(e.id)}
                          onChange={() => toggle(selectedExpenseIds, e.id, setSelectedExpenseIds)}
                          className="accent-blue-600"
                        />
                        <span className="flex-1 truncate">{new Date(e.date).toLocaleDateString("sv-SE")} — {e.description}</span>
                        <span className="text-gray-500">{formatCurrency(e.amount)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium mb-1">Dra av acconto-fakturor</p>
                {availableAccontos.length === 0 ? (
                  <p className="text-xs text-gray-400">Inga tillgängliga acconto-fakturor.</p>
                ) : (
                  <div className="border border-gray-200 rounded divide-y divide-gray-100">
                    {availableAccontos.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedAccontoIds.includes(a.id)}
                          onChange={() => toggle(selectedAccontoIds, a.id, setSelectedAccontoIds)}
                          className="accent-blue-600"
                        />
                        <span className="flex-1">Acconto {new Date(a.invoiceDate).toLocaleDateString("sv-SE")}</span>
                        <span className="font-mono">−{formatCurrency(a.amount)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={finalDueDateId} className="block text-xs font-medium mb-1">Förfallodatum</label>
                  <input id={finalDueDateId} type="date" value={finalDueDate} onChange={(e) => setFinalDueDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label htmlFor={finalNotesId} className="block text-xs font-medium mb-1">Notering</label>
                  <input id={finalNotesId} value={finalNotes} onChange={(e) => setFinalNotes(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowFinal(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
              <button
                disabled={createFinal.isPending || (selectedTimeIds.length === 0 && selectedExpenseIds.length === 0)}
                onClick={() =>
                  createFinal.mutate({
                    matterId,
                    timeEntryIds: selectedTimeIds,
                    expenseIds: selectedExpenseIds,
                    accontoInvoiceIds: selectedAccontoIds,
                    dueDate: finalDueDate || undefined,
                    notes: finalNotes || undefined,
                  })
                }
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {createFinal.isPending ? "Skapar…" : "Skapa slutfaktura"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
