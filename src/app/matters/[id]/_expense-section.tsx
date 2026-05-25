"use client";

import { useState } from "react";
import { trpc } from "@/client/lib/trpc";
import { formatCurrency } from "@/client/lib/utils";
import { splitVat, VAT_RATES, VAT_RATE_LABELS, type VatRate } from "@/shared/vat";

interface Props {
  matterId: string;
  /** Matter-flagga — om true visas Domstolsverket-information. */
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

// eslint-disable-next-line complexity
export function ExpenseSection({ matterId, isTaxeArende }: Props) {
  const utils = trpc.useUtils();
  const expenses = trpc.expense.list.useQuery({ matterId });
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(initialForm);

  function resetForm(): void {
    setShowExpenseForm(false);
    setEditingId(null);
    setExpenseForm(initialForm());
  }

  const createExpense = trpc.expense.create.useMutation({ onSuccess: () => { utils.expense.list.invalidate({ matterId }); resetForm(); } });
  const updateExpense = trpc.expense.update.useMutation({ onSuccess: () => { utils.expense.list.invalidate({ matterId }); resetForm(); } });
  const deleteExpense = trpc.expense.delete.useMutation({
    onSuccess: () => utils.expense.list.invalidate({ matterId }),
  });

  function startEdit(e: Expense): void {
    setEditingId(e.id);
    setShowExpenseForm(true);
    setExpenseForm({
      date: new Date(e.date).toISOString().split("T")[0],
      amount: e.amount / 100,
      description: e.description,
      billable: e.billable,
      vatRate: (e.vatRate ?? 2500) as VatRate,
      vatIncluded: e.vatIncluded ?? true,
    });
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          Utlägg
          {expenses.data && expenses.data.totalAmount > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatCurrency(expenses.data.totalAmount)})</span>
          )}
        </h2>
        <button onClick={() => showExpenseForm ? resetForm() : setShowExpenseForm(true)} className="text-sm text-blue-600 hover:underline">
          {showExpenseForm ? "Avbryt" : "+ Nytt utlägg"}
        </button>
      </div>

      {showExpenseForm && (
        <form onSubmit={(e) => {
          e.preventDefault();
          const payload = {
            date: expenseForm.date,
            amount: Math.round(expenseForm.amount * 100),
            description: expenseForm.description,
            billable: expenseForm.billable,
            vatRate: expenseForm.vatRate,
            vatIncluded: expenseForm.vatIncluded,
          };
          if (editingId) updateExpense.mutate({ id: editingId, ...payload });
          else createExpense.mutate({ matterId, ...payload });
        }} className="p-4 border-b border-gray-200 space-y-3">
          {isTaxeArende && (
            <div className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
              <strong>Taxeärende</strong> — utläggsersättningen bestäms av domstolen
              enligt Domstolsverkets föreskrifter (DVFS). Registrera utlägget enligt
              kvitto; statens faktiska ersättning kan avvika.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="date" required value={expenseForm.date}
              onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
            <div className="flex items-center gap-2">
              <input type="number" required min={0} step="0.01" value={expenseForm.amount || ""}
                onChange={(e) => setExpenseForm({ ...expenseForm, amount: parseFloat(e.target.value) || 0 })}
                placeholder="0,00"
                className="w-28 rounded border border-gray-300 px-3 py-1.5 text-sm" />
              <span className="text-sm text-gray-500">SEK</span>
            </div>
            <input type="text" required placeholder="Beskrivning *" value={expenseForm.description}
              onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
              className="md:col-span-2 rounded border border-gray-300 px-3 py-1.5 text-sm" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-center">
            <select value={expenseForm.vatRate}
              onChange={(e) => setExpenseForm({ ...expenseForm, vatRate: Number(e.target.value) as VatRate })}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm">
              {VAT_RATES.map((r) => <option key={r} value={r}>Moms: {VAT_RATE_LABELS[r]}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="vatIncl" checked={expenseForm.vatIncluded}
                onChange={() => setExpenseForm({ ...expenseForm, vatIncluded: true })} />
              Inkl moms
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="vatIncl" checked={!expenseForm.vatIncluded}
                onChange={() => setExpenseForm({ ...expenseForm, vatIncluded: false })} />
              Exkl moms
            </label>
            <VatPreview amount={expenseForm.amount} vatRate={expenseForm.vatRate} vatIncluded={expenseForm.vatIncluded} />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={expenseForm.billable}
                onChange={(e) => setExpenseForm({ ...expenseForm, billable: e.target.checked })} />
              Debiterbar
            </label>
            <button type="submit" disabled={createExpense.isPending || updateExpense.isPending}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {(createExpense.isPending || updateExpense.isPending) ? "Sparar..." : (editingId ? "Spara ändring" : "Spara")}
            </button>
          </div>
        </form>
      )}

      <ExpenseTable
        expenses={expenses.data?.expenses ?? []}
        onEdit={(e) => { startEdit(e); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        onDelete={(id) => { if (confirm("Ta bort utlägget?")) deleteExpense.mutate({ id }); }}
      />
    </div>
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

function ExpenseTable({ expenses, onEdit, onDelete }: { expenses: Expense[]; onEdit: (e: Expense) => void; onDelete: (id: string) => void }) {
  // Totalsumma exkl/moms/inkl
  const totals = expenses.reduce(
    (acc, e) => {
      const r = splitVat({
        amount: e.amount,
        vatRate: e.vatRate ?? 2500,
        vatIncluded: e.vatIncluded ?? true,
      });
      return { exclVat: acc.exclVat + r.exclVat, vat: acc.vat + r.vat, inclVat: acc.inclVat + r.inclVat };
    },
    { exclVat: 0, vat: 0, inclVat: 0 },
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Av</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
            <th className="px-6 py-2 text-right text-xs font-medium text-gray-500 uppercase">Exkl moms</th>
            <th className="px-6 py-2 text-right text-xs font-medium text-gray-500 uppercase">Moms</th>
            <th className="px-6 py-2 text-right text-xs font-medium text-gray-500 uppercase">Inkl moms</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Deb.</th>
            <th className="px-6 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {/* eslint-disable-next-line complexity */}
          {expenses.map((expense) => {
            const r = splitVat({
              amount: expense.amount,
              vatRate: expense.vatRate ?? 2500,
              vatIncluded: expense.vatIncluded ?? true,
            });
            const rateLabel = expense.vatRate === 0 ? "0 %"
              : expense.vatRate === 600 ? "6 %"
              : expense.vatRate === 1200 ? "12 %" : "25 %";
            return (
              <tr key={expense.id}>
                <td className="px-6 py-2 text-sm text-gray-500 whitespace-nowrap">{new Date(expense.date).toLocaleDateString("sv-SE")}</td>
                <td className="px-6 py-2 text-sm text-gray-900 whitespace-nowrap">{expense.user?.name ?? "—"}</td>
                <td className="px-6 py-2 text-sm text-gray-700">{expense.description}</td>
                <td className="px-6 py-2 text-sm font-mono text-gray-900 text-right whitespace-nowrap">{formatCurrency(r.exclVat)}</td>
                <td className="px-6 py-2 text-sm font-mono text-gray-500 text-right whitespace-nowrap" title={`${rateLabel}`}>{formatCurrency(r.vat)}</td>
                <td className="px-6 py-2 text-sm font-mono text-gray-900 text-right whitespace-nowrap">{formatCurrency(r.inclVat)}</td>
                <td className="px-6 py-2 text-sm">{expense.billable ? "Ja" : "Nej"}</td>
                <td className="px-6 py-2 text-right whitespace-nowrap">
                  <button onClick={() => onEdit(expense)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">
                    Ändra
                  </button>
                  <button onClick={() => onDelete(expense.id)} className="text-xs text-red-500 hover:underline">
                    Ta bort
                  </button>
                </td>
              </tr>
            );
          })}
          {expenses.length === 0 && (
            <tr>
              <td colSpan={8} className="px-6 py-4 text-sm text-gray-500">Inga utlägg registrerade</td>
            </tr>
          )}
          {expenses.length > 0 && (
            <tr className="bg-gray-50 font-medium">
              <td colSpan={3} className="px-6 py-2 text-sm text-gray-700 text-right">Summa:</td>
              <td className="px-6 py-2 text-sm font-mono text-right">{formatCurrency(totals.exclVat)}</td>
              <td className="px-6 py-2 text-sm font-mono text-right">{formatCurrency(totals.vat)}</td>
              <td className="px-6 py-2 text-sm font-mono text-right">{formatCurrency(totals.inclVat)}</td>
              <td colSpan={2}></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
