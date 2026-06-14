"use client";

/**
 * Fakturablock på matter-sidan:
 *   - lista alla fakturor på ärendet med typ/status/belopp
 *   - knappar: "Skapa acconto" + "Skapa slutfaktura"
 *   - modal för ACCONTO (belopp, förfallodatum, notes) → {@link AccontoModal}
 *   - modal för FINAL (välj time entries, expenses, acconto-avdrag) → {@link FinalInvoiceModal}
 *
 * Modalerna + den generiska {@link CheckboxList} är utbrutna ur containern (#6)
 * så InvoicesSection håller sig under complexity@8 + max-lines utan undantag.
 * Detaljer (betalningar, avbetalningsplan) hanteras på /invoices/[id].
 */

import { useId, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";

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

// ─── Generisk kryssruta-lista (delas av slutfaktura-modalens tre sektioner) ──

interface CheckboxListProps<T> {
  title: string;
  emptyMessage: string;
  items: T[];
  getId: (item: T) => string;
  selectedIds: string[];
  onToggle: (id: string) => void;
  renderRow: (item: T) => ReactNode;
  /** Tailwind max-höjd för scroll (tom = ingen). */
  maxHeight?: string;
}

function CheckboxList<T>({ title, emptyMessage, items, getId, selectedIds, onToggle, renderRow, maxHeight = "max-h-40" }: CheckboxListProps<T>) {
  return (
    <div>
      <p className="text-xs font-medium mb-1">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyMessage}</p>
      ) : (
        <div className={`${maxHeight} overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100`}>
          {items.map((item) => {
            const id = getId(item);
            return (
              <label key={id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(id)}
                  onChange={() => onToggle(id)}
                  className="accent-blue-600"
                />
                {renderRow(item)}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ACCONTO-modal ───────────────────────────────────────────────────

function AccontoModal({ matterId, onClose }: { matterId: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [amountSek, setAmountSek] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const amountId = useId();
  const dueDateId = useId();
  const notesId = useId();

  const create = trpc.invoice.createAcconto.useMutation({
    onSuccess: () => { void utils.invoice.list.invalidate({ matterId }); onClose(); },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-semibold mb-4">Ny acconto-faktura</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor={amountId} className="block text-xs font-medium mb-1">Belopp (kr)</label>
            <input
              id={amountId}
              type="number" min={1}
              value={amountSek}
              onChange={(e) => setAmountSek(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor={dueDateId} className="block text-xs font-medium mb-1">Förfallodatum</label>
            <input
              id={dueDateId}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor={notesId} className="block text-xs font-medium mb-1">Notering (valfri)</label>
            <textarea
              id={notesId}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
          <button
            disabled={!amountSek || create.isPending}
            onClick={() =>
              create.mutate({
                matterId,
                amount: Math.round(Number(amountSek) * 100),
                dueDate: dueDate || undefined,
                notes: notes || undefined,
              })
            }
            className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
          >
            {create.isPending ? "Skapar…" : "Skapa"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FINAL-modal (slutfaktura) ───────────────────────────────────────

interface UnbilledTime { id: string; date: string | Date; description: string; minutes: number }
interface UnbilledExpense { id: string; date: string | Date; description: string; amount: number }
interface AccontoOption { id: string; invoiceDate: string | Date; amount: number }

interface FinalModalProps {
  matterId: string;
  timeEntries: UnbilledTime[];
  expenses: UnbilledExpense[];
  accontos: AccontoOption[];
  onClose: () => void;
}

const sv = (d: string | Date): string => new Date(d).toLocaleDateString("sv-SE");

const timeRow = (t: UnbilledTime): ReactNode => (
  <>
    <span className="flex-1 truncate">{sv(t.date)} — {t.description}</span>
    <span className="text-gray-500">{(t.minutes / 60).toFixed(1)}h</span>
  </>
);
const expenseRow = (e: UnbilledExpense): ReactNode => (
  <>
    <span className="flex-1 truncate">{sv(e.date)} — {e.description}</span>
    <span className="text-gray-500">{formatCurrency(e.amount)}</span>
  </>
);
const accontoRow = (a: AccontoOption): ReactNode => (
  <>
    <span className="flex-1">Acconto {sv(a.invoiceDate)}</span>
    <span className="font-mono">−{formatCurrency(a.amount)}</span>
  </>
);

/** Förfallodatum + notering + Avbryt/Skapa-knappar (footer för slutfaktura-modalen). */
function FinalModalFooter({ dueDate, setDueDate, notes, setNotes, error, disabled, pending, onCancel, onSubmit }: {
  dueDate: string; setDueDate: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  error: string | null; disabled: boolean; pending: boolean;
  onCancel: () => void; onSubmit: () => void;
}) {
  const dueDateId = useId();
  const notesId = useId();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={dueDateId} className="block text-xs font-medium mb-1">Förfallodatum</label>
          <input id={dueDateId} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor={notesId} className="block text-xs font-medium mb-1">Notering</label>
          <input id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end mt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
        <button
          disabled={disabled}
          onClick={onSubmit}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Skapar…" : "Skapa slutfaktura"}
        </button>
      </div>
    </>
  );
}

function FinalInvoiceModal({ matterId, timeEntries, expenses, accontos, onClose }: FinalModalProps) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [timeIds, setTimeIds] = useState<string[]>([]);
  const [expenseIds, setExpenseIds] = useState<string[]>([]);
  const [accontoIds, setAccontoIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const create = trpc.invoice.createFinal.useMutation({
    onSuccess: () => {
      void utils.invoice.list.invalidate({ matterId });
      void utils.timeEntry.list.invalidate({ matterId });
      void utils.expense.list.invalidate({ matterId });
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const toggle = (ids: string[], setter: (v: string[]) => void, id: string) =>
    setter(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold mb-4">Skapa slutfaktura</h3>

        <div className="space-y-4">
          <CheckboxList
            title="Tidsposter att fakturera"
            emptyMessage="Inga ofakturerade tidsposter."
            items={timeEntries}
            getId={(t) => t.id}
            selectedIds={timeIds}
            onToggle={(id) => toggle(timeIds, setTimeIds, id)}
            renderRow={timeRow}
          />

          <CheckboxList
            title="Utlägg"
            emptyMessage="Inga ofakturerade utlägg."
            items={expenses}
            getId={(e) => e.id}
            selectedIds={expenseIds}
            onToggle={(id) => toggle(expenseIds, setExpenseIds, id)}
            maxHeight="max-h-32"
            renderRow={expenseRow}
          />

          <CheckboxList
            title="Dra av acconto-fakturor"
            emptyMessage="Inga tillgängliga acconto-fakturor."
            items={accontos}
            getId={(a) => a.id}
            selectedIds={accontoIds}
            onToggle={(id) => toggle(accontoIds, setAccontoIds, id)}
            maxHeight=""
            renderRow={accontoRow}
          />

          <FinalModalFooter
            dueDate={dueDate} setDueDate={setDueDate}
            notes={notes} setNotes={setNotes}
            error={error}
            disabled={create.isPending || (timeIds.length === 0 && expenseIds.length === 0)}
            pending={create.isPending}
            onCancel={onClose}
            onSubmit={() =>
              create.mutate({
                matterId,
                timeEntryIds: timeIds,
                expenseIds,
                accontoInvoiceIds: accontoIds,
                dueDate: dueDate || undefined,
                notes: notes || undefined,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

// ─── Härledning (utbruten → containern håller complexity ≤8) ──────────

/** Poster utan koppling till en faktura. */
function unbilled<T extends { invoiceId?: string | null | undefined }>(items: T[] | undefined): T[] {
  return items?.filter((x) => !x.invoiceId) ?? [];
}

/** Acconto-fakturor som ännu kan dras av på en slutfaktura. */
function pickAvailableAccontos<T extends { invoiceType: string; status: string; deductedOnFinals?: unknown }>(invoices: T[]): T[] {
  return invoices.filter((i) => {
    const deducted = i.deductedOnFinals as { id: string }[] | undefined;
    return i.invoiceType === "ACCONTO" && deducted?.length === 0 && i.status !== "CANCELLED";
  });
}

// ─── Container ───────────────────────────────────────────────────────

export function InvoicesSection({ matterId }: { matterId: string }) {
  const invoices = trpc.invoice.list.useQuery({ matterId });
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId });
  const expenses = trpc.expense.list.useQuery({ matterId });

  const [showAcconto, setShowAcconto] = useState(false);
  const [showFinal, setShowFinal] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Fakturor</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAcconto(true)}
            className="px-3 py-1.5 text-sm border border-purple-200 bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
          >
            + Acconto
          </button>
          <button
            onClick={() => setShowFinal(true)}
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

      {showAcconto && <AccontoModal matterId={matterId} onClose={() => setShowAcconto(false)} />}
      {showFinal && (
        <FinalInvoiceModal
          matterId={matterId}
          timeEntries={unbilled(timeEntries.data?.entries)}
          expenses={unbilled(expenses.data?.expenses)}
          accontos={pickAvailableAccontos(invoices.data ?? [])}
          onClose={() => setShowFinal(false)}
        />
      )}
    </div>
  );
}
