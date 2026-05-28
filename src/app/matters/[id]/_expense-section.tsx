"use client";

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { splitVat, VAT_RATES, VAT_RATE_LABELS, type VatRate } from "@/lib/shared/vat";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";

interface Props {
  matterId: string;
  isTaxeArende?: boolean;
}

interface ExpenseForm {
  date: string;
  amount: number;
  description: string;
  billable: boolean;
  vatRate: VatRate;
  vatIncluded: boolean;
}

interface Expense {
  id: string;
  date: Date | string;
  amount: number;
  description: string;
  billable: boolean;
  user?: { name: string };
  vatRate?: number;
  vatIncluded?: boolean;
}

function initialForm(): ExpenseForm {
  return {
    date: new Date().toISOString().split("T")[0],
    amount: 0,
    description: "",
    billable: true,
    vatRate: 2500,
    vatIncluded: true,
  };
}

function toForm(e: Expense): ExpenseForm {
  return {
    date: new Date(e.date).toISOString().split("T")[0],
    amount: e.amount / 100,
    description: e.description,
    billable: e.billable,
    vatRate: (e.vatRate ?? 2500) as VatRate,
    vatIncluded: e.vatIncluded ?? true,
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
  return {
    date: f.date,
    amount: Math.round(f.amount * 100),
    description: f.description,
    billable: f.billable,
    vatRate: f.vatRate,
    vatIncluded: f.vatIncluded,
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

// eslint-disable-next-line complexity -- TODO: refactor (JSX-conditionals i header + summary)
export function ExpenseSection({ matterId, isTaxeArende }: Props) {
  const utils = trpc.useUtils();
  const expenses = trpc.expense.list.useQuery({ matterId });
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(initialForm);

  function resetClose(): void {
    setShowCreate(false);
    setEditingId(null);
    setForm(initialForm());
  }

  const createExpense = trpc.expense.create.useMutation({ onSuccess: () => { utils.expense.list.invalidate({ matterId }); resetClose(); } });
  const updateExpense = trpc.expense.update.useMutation({ onSuccess: () => { utils.expense.list.invalidate({ matterId }); resetClose(); } });
  const deleteExpense = trpc.expense.delete.useMutation({ onSuccess: () => utils.expense.list.invalidate({ matterId }) });

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
  const totals = computeTotals(items);
  const isPending = createExpense.isPending || updateExpense.isPending;

  const columns: Column<Expense>[] = [
    { key: "date", label: "Datum", sortable: true, sortValue: (e) => new Date(e.date),
      render: (e) => <span className="text-sm text-gray-500 whitespace-nowrap">{new Date(e.date).toLocaleDateString("sv-SE")}</span> },
    { key: "user", label: "Av", sortable: true, sortValue: (e) => e.user?.name ?? "",
      render: (e) => <span className="text-sm text-gray-900 whitespace-nowrap">{e.user?.name ?? "—"}</span> },
    { key: "description", label: "Beskrivning", sortable: true, sortValue: (e) => e.description,
      render: (e) => <span className="text-sm text-gray-700">{e.description}</span> },
    { key: "exclVat", label: "Exkl moms", sortable: true, align: "right",
      sortValue: (e) => splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).exclVat,
      render: (e) => <span className="text-sm font-mono text-gray-900 whitespace-nowrap">{formatCurrency(splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).exclVat)}</span> },
    { key: "vat", label: "Moms", sortable: true, align: "right",
      sortValue: (e) => splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).vat,
      render: (e) => <span className="text-sm font-mono text-gray-500 whitespace-nowrap">{formatCurrency(splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).vat)}</span> },
    { key: "inclVat", label: "Inkl moms", sortable: true, align: "right",
      sortValue: (e) => splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).inclVat,
      render: (e) => <span className="text-sm font-mono text-gray-900 whitespace-nowrap">{formatCurrency(splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).inclVat)}</span> },
    { key: "billable", label: "Deb.", sortable: true, sortValue: (e) => (e.billable ? 1 : 0),
      render: (e) => <span className="text-sm">{e.billable ? "Ja" : "Nej"}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (e) => (
        <span className="whitespace-nowrap">
          <button onClick={() => startEdit(e)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">Ändra</button>
          <button onClick={() => { if (confirm("Ta bort utlägget?")) deleteExpense.mutate({ id: e.id }); }} className="text-xs text-red-500 hover:underline">Ta bort</button>
        </span>
      ),
    },
  ];

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
        />
        {items.length > 0 && (
          <div className="mt-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded text-sm flex items-center justify-end gap-6 font-medium">
            <span className="text-gray-700">Summa:</span>
            <span className="font-mono">Exkl: {formatCurrency(totals.exclVat)}</span>
            <span className="font-mono">Moms: {formatCurrency(totals.vat)}</span>
            <span className="font-mono">Inkl: {formatCurrency(totals.inclVat)}</span>
          </div>
        )}
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
  isTaxeArende?: boolean;
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
          <label className="block text-xs text-gray-500 mb-1">Belopp (SEK) *</label>
          <input type="number" required min={0} step="0.01" value={form.amount || ""}
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
      <div className="grid grid-cols-2 gap-3 items-center">
        <select value={form.vatRate}
          onChange={(e) => setForm({ ...form, vatRate: Number(e.target.value) as VatRate })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm">
          {VAT_RATES.map((r) => <option key={r} value={r}>Moms: {VAT_RATE_LABELS[r]}</option>)}
        </select>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="vatIncl" checked={form.vatIncluded}
              onChange={() => setForm({ ...form, vatIncluded: true })} />
            Inkl moms
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="vatIncl" checked={!form.vatIncluded}
              onChange={() => setForm({ ...form, vatIncluded: false })} />
            Exkl moms
          </label>
        </div>
      </div>
      <VatPreview amount={form.amount} vatRate={form.vatRate} vatIncluded={form.vatIncluded} />
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

function VatPreview({ amount, vatRate, vatIncluded }: { amount: number; vatRate: number; vatIncluded: boolean }) {
  if (!amount) return <span className="text-xs text-gray-400">Förhandsvisning</span>;
  const r = splitVat({ amount: Math.round(amount * 100), vatRate, vatIncluded });
  return (
    <span className="text-xs text-gray-600 font-mono">
      Ex: {formatCurrency(r.exclVat)} · M: {formatCurrency(r.vat)} · In: {formatCurrency(r.inclVat)}
    </span>
  );
}
