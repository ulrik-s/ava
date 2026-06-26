"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import type { ExpenseId, InvoiceId, MatterId } from "@/lib/shared/schemas/ids";
import { splitVat, VAT_RATES, VAT_RATE_LABELS, type VatRate } from "@/lib/shared/vat";

interface Props {
  matterId: MatterId;
  isTaxeArende?: boolean;
}

interface ExpenseForm {
  date: string;
  /** Belopp i kr EXKL. moms — advokaten matar in exkl., AVA lägger på momsen (#781). */
  amount: number;
  description: string;
  billable: boolean;
  vatRate: VatRate;
}

interface Expense {
  id: ExpenseId;
  date: Date | string;
  amount: number;
  description: string;
  billable: boolean;
  user?: { name: string };
  vatRate?: number;
  vatIncluded?: boolean;
  invoiceId?: InvoiceId | null;
  invoice?: { id: InvoiceId; invoiceNumber?: string | null } | null;
}

function initialForm(): ExpenseForm {
  return {
    date: new Date().toISOString().split("T")[0]!,
    amount: 0,
    description: "",
    billable: true,
    vatRate: 2500,
  };
}

function toForm(e: Expense): ExpenseForm {
  // Visa beloppet EXKL. moms i formuläret oavsett hur det lagrats.
  const exclOre = splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).exclVat;
  return {
    date: new Date(e.date).toISOString().split("T")[0]!,
    amount: exclOre / 100,
    description: e.description,
    billable: e.billable,
    vatRate: (e.vatRate ?? 2500) as VatRate,
  };
}

function payloadOf(f: ExpenseForm): {
  date: string;
  amount: number;
  description: string;
  billable: boolean;
  vatRate: VatRate;
  vatIncluded: boolean;
} {
  // Advokaten matar in exkl. moms; utlägg lagras netto (#782) och AVA lägger
  // på momsen vid fakturering.
  return {
    date: f.date,
    amount: Math.round(f.amount * 100),
    description: f.description,
    billable: f.billable,
    vatRate: f.vatRate,
    vatIncluded: false,
  };
}

function computeTotals(expenses: Expense[]): { exclVat: number; vat: number; inclVat: number } {
  return expenses.reduce(
    (acc, e) => {
      const r = splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true });
      return { exclVat: acc.exclVat + r.exclVat, vat: acc.vat + r.vat, inclVat: acc.inclVat + r.inclVat };
    },
    { exclVat: 0, vat: 0, inclVat: 0 },
  );
}

 
function vatOf(e: Expense) {
  return splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true });
}
function invoiceLabel(e: Expense): string {
  return e.invoice?.invoiceNumber ?? (e.invoiceId ? "(faktura)" : "Ej fakturerad");
}
function isInvoiced(e: Expense): boolean {
  return e.invoiceId != null && e.invoiceId !== "";
}

/** Tabell-kolumnerna för utläggslistan. Redigera/ta-bort låsta för
 *  fakturerade utlägg (de sitter på en utställd faktura). */
function expenseColumns({ onEdit, onDelete }: { onEdit: (e: Expense) => void; onDelete: (id: ExpenseId) => void }): Column<Expense>[] {
  return [
    { key: "date", label: "Datum", sortable: true, filterable: true, sortValue: (e) => new Date(e.date),
      filterValue: (e) => new Date(e.date).toLocaleDateString("sv-SE"),
      render: (e) => <span className="text-sm text-gray-500 whitespace-nowrap">{new Date(e.date).toLocaleDateString("sv-SE")}</span> },
    { key: "user", label: "Av", sortable: true, filterable: true, groupable: true,
      sortValue: (e) => e.user?.name ?? "", filterValue: (e) => e.user?.name ?? "",
      render: (e) => <span className="text-sm text-gray-900 whitespace-nowrap">{e.user?.name ?? "—"}</span> },
    { key: "description", label: "Beskrivning", sortable: true, filterable: true,
      sortValue: (e) => e.description, filterValue: (e) => e.description,
      render: (e) => <span className="text-sm text-gray-700">{e.description}</span> },
    { key: "exclVat", label: "Exkl moms", sortable: true, align: "right",
      sortValue: (e) => vatOf(e).exclVat,
      render: (e) => <span className="text-sm font-mono text-gray-900 whitespace-nowrap">{formatCurrency(vatOf(e).exclVat)}</span> },
    { key: "vat", label: "Moms", sortable: true, align: "right",
      sortValue: (e) => vatOf(e).vat,
      render: (e) => <span className="text-sm font-mono text-gray-500 whitespace-nowrap">{formatCurrency(vatOf(e).vat)}</span> },
    { key: "inclVat", label: "Inkl moms", sortable: true, align: "right",
      sortValue: (e) => vatOf(e).inclVat,
      render: (e) => <span className="text-sm font-mono text-gray-900 whitespace-nowrap">{formatCurrency(vatOf(e).inclVat)}</span> },
    { key: "billable", label: "Deb.", sortable: true, filterable: true,
      sortValue: (e) => (e.billable ? 1 : 0), filterValue: (e) => (e.billable ? "Ja" : "Nej"),
      render: (e) => <span className="text-sm">{e.billable ? "Ja" : "Nej"}</span> },
    { key: "invoice", label: "Faktura", sortable: true, filterable: true, groupable: true,
      sortValue: (e) => invoiceLabel(e), filterValue: (e) => invoiceLabel(e), groupValue: (e) => invoiceLabel(e),
      render: (e) => (
        isInvoiced(e) && e.invoiceId
          ? <EntityLink route="invoices" id={e.invoiceId} className="text-sm text-blue-600 hover:underline">{e.invoice?.invoiceNumber ?? e.invoiceId.slice(0, 8)}</EntityLink>
          : <span className="text-sm text-gray-400">—</span>
      ),
    },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (e) => (
        isInvoiced(e)
          ? <span className="text-xs text-gray-400 italic">Låst (på faktura)</span>
          : <span className="whitespace-nowrap">
              <button onClick={() => onEdit(e)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">Ändra</button>
              <button onClick={() => { if (confirm("Ta bort utlägget?")) onDelete(e.id); }} className="text-xs text-red-500 hover:underline">Ta bort</button>
            </span>
      ),
    },
  ];
}

/** Summa-rad (footer) för utläggstabellen. */
function expenseFooter(rows: Expense[]): Partial<Record<string, React.ReactNode>> {
  const t = computeTotals(rows);
  return {
    description: <span className="text-gray-700">Summa</span>,
    exclVat: <span className="font-mono text-gray-900">{formatCurrency(t.exclVat)}</span>,
    vat: <span className="font-mono text-gray-700">{formatCurrency(t.vat)}</span>,
    inclVat: <span className="font-mono text-gray-900">{formatCurrency(t.inclVat)}</span>,
  };
}

export function ExpenseSection({ matterId, isTaxeArende }: Props) {
  const utils = trpc.useUtils();
  const expenses = trpc.expense.list.useQuery({ matterId });
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<ExpenseId | null>(null);
  const [form, setForm] = useState<ExpenseForm>(initialForm);

  function resetClose(): void {
    setShowCreate(false);
    setEditingId(null);
    setForm(initialForm());
  }

  const createExpense = trpc.expense.create.useMutation({ onSuccess: () => { void utils.expense.list.invalidate({ matterId }); resetClose(); } });
  const updateExpense = trpc.expense.update.useMutation({ onSuccess: () => { void utils.expense.list.invalidate({ matterId }); resetClose(); } });
  const deleteExpense = trpc.expense.delete.useMutation({ onSuccess: () => void utils.expense.list.invalidate({ matterId }) });

  function startEdit(e: Expense): void {
    setEditingId(e.id);
    setForm(toForm(e));
  }

  function submitForm(): void {
    const payload = payloadOf(form);
    if (editingId) updateExpense.mutate({ id: editingId, ...payload });
    else createExpense.mutate({ matterId, ...payload });
  }

  const items = (expenses.data?.expenses ?? []) as Expense[];
  const isPending = createExpense.isPending || updateExpense.isPending;

  const columns = expenseColumns({ onEdit: startEdit, onDelete: (id) => deleteExpense.mutate({ id }) });

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          Utlägg
          {expenses.data && expenses.data.totalAmount > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatCurrency(expenses.data.totalAmount)})</span>
          )}
        </h2>
        <button onClick={() => setShowCreate(true)} className="text-sm text-blue-600 hover:underline">+ Nytt utlägg</button>
      </div>

      <div className="p-4">
        <DataTable
          prefKey={`list.matter-expenses.${matterId}`}
          columns={columns}
          data={items}
          rowKey={(e) => e.id}
          emptyMessage="Inga utlägg registrerade"
          footer={expenseFooter}
        />
      </div>

      <Modal open={showCreate} title="Nytt utlägg" onClose={resetClose} widthClass="max-w-xl">
        <ExpenseForm form={form} setForm={setForm} isPending={isPending} isTaxeArende={isTaxeArende}
          onSubmit={submitForm} onCancel={resetClose} submitLabel={isPending ? "Sparar..." : "Spara"} />
      </Modal>

      <Modal open={editingId !== null} title="Ändra utlägg" onClose={resetClose} widthClass="max-w-xl">
        <ExpenseForm form={form} setForm={setForm} isPending={isPending} isTaxeArende={isTaxeArende}
          onSubmit={submitForm} onCancel={resetClose} submitLabel={isPending ? "Sparar..." : "Spara ändring"} />
      </Modal>
    </div>
  );
}

interface FormProps {
  form: ExpenseForm;
  setForm: (f: ExpenseForm) => void;
  submitLabel: string;
  isPending: boolean;
  isTaxeArende?: boolean | undefined;
  onSubmit: () => void;
  onCancel: () => void;
}

function ExpenseForm({ form, setForm, submitLabel, isPending, isTaxeArende, onSubmit, onCancel }: FormProps) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-3">
      {isTaxeArende && (
        <div className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
          <strong>Taxeärende</strong> — utläggsersättningen bestäms av domstolen
          enligt Domstolsverkets föreskrifter (DVFS). Registrera utlägget enligt
          kvitto; statens faktiska ersättning kan avvika.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Datum *</label>
          <input type="date" required value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Belopp (SEK, exkl. moms) *</label>
          <input type="text" inputMode="decimal" required value={form.amount || ""}
            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
            placeholder="0,00"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Beskrivning *</label>
        <input type="text" required value={form.description}
          placeholder="Beskrivning *"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Momssats</label>
        <select value={form.vatRate}
          onChange={(e) => setForm({ ...form, vatRate: Number(e.target.value) as VatRate })}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
          {VAT_RATES.map((r) => <option key={r} value={r}>Moms: {VAT_RATE_LABELS[r]}</option>)}
        </select>
        <p className="mt-1 text-[11px] text-gray-400">
          Ange beloppet exkl. moms — AVA lägger på momsen. Default 25 %; välj 0 % för momsfritt (t.ex. domstolsavgift).
        </p>
      </div>
      <VatPreview amount={form.amount} vatRate={form.vatRate} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.billable}
          onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
        Debiterbar
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Avbryt
        </button>
        <button type="submit" disabled={isPending}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function VatPreview({ amount, vatRate }: { amount: number; vatRate: number }) {
  if (!amount) return <span className="text-xs text-gray-400">Förhandsvisning</span>;
  // Inmatat belopp är exkl. moms → räkna fram moms + inkl.
  const r = splitVat({ amount: Math.round(amount * 100), vatRate, vatIncluded: false });
  return (
    <span className="text-xs text-gray-600 font-mono">
      Exkl: {formatCurrency(r.exclVat)} · moms: {formatCurrency(r.vat)} · inkl: {formatCurrency(r.inclVat)}
    </span>
  );
}
