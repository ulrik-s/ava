"use client";

import { useState } from "react";
import { trpc } from "@/client/lib/trpc";
import { formatCurrency } from "@/client/lib/utils";

interface Props {
  matterId: string;
}

export function ExpenseSection({ matterId }: Props) {
  const utils = trpc.useUtils();
  const expenses = trpc.expense.list.useQuery({ matterId });
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: 0,
    description: "",
    billable: true,
  });

  const createExpense = trpc.expense.create.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate({ matterId });
      setShowExpenseForm(false);
      setExpenseForm({
        date: new Date().toISOString().split("T")[0],
        amount: 0,
        description: "",
        billable: true,
      });
    },
  });

  const deleteExpense = trpc.expense.delete.useMutation({
    onSuccess: () => utils.expense.list.invalidate({ matterId }),
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          Utlägg
          {expenses.data && expenses.data.totalAmount > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatCurrency(expenses.data.totalAmount)})</span>
          )}
        </h2>
        <button onClick={() => setShowExpenseForm(!showExpenseForm)} className="text-sm text-blue-600 hover:underline">
          {showExpenseForm ? "Avbryt" : "+ Nytt utlägg"}
        </button>
      </div>

      {showExpenseForm && (
        <form onSubmit={(e) => {
          e.preventDefault();
          createExpense.mutate({
            matterId,
            date: expenseForm.date,
            amount: Math.round(expenseForm.amount * 100),
            description: expenseForm.description,
            billable: expenseForm.billable,
          });
        }} className="p-4 border-b border-gray-200">
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
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={expenseForm.billable}
                onChange={(e) => setExpenseForm({ ...expenseForm, billable: e.target.checked })} />
              Debiterbar
            </label>
            <button type="submit" disabled={createExpense.isPending}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {createExpense.isPending ? "Sparar..." : "Spara"}
            </button>
          </div>
        </form>
      )}

      <ExpenseTable
        expenses={expenses.data?.expenses ?? []}
        onDelete={(id) => deleteExpense.mutate({ id })}
      />
    </div>
  );
}

interface Expense {
  id: string;
  date: Date | string;
  amount: number;
  description: string;
  billable: boolean;
  user: { name: string };
}

function ExpenseTable({ expenses, onDelete }: { expenses: Expense[]; onDelete: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Registrerad av</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Belopp</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Deb.</th>
            <th className="px-6 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {expenses.map((expense) => (
            <tr key={expense.id}>
              <td className="px-6 py-2 text-sm text-gray-500 whitespace-nowrap">{new Date(expense.date).toLocaleDateString("sv-SE")}</td>
              <td className="px-6 py-2 text-sm text-gray-900 whitespace-nowrap">{expense.user.name}</td>
              <td className="px-6 py-2 text-sm font-mono text-gray-900 whitespace-nowrap">{formatCurrency(expense.amount)}</td>
              <td className="px-6 py-2 text-sm text-gray-700">{expense.description}</td>
              <td className="px-6 py-2 text-sm">{expense.billable ? "Ja" : "Nej"}</td>
              <td className="px-6 py-2 text-right">
                <button onClick={() => onDelete(expense.id)} className="text-xs text-red-500 hover:underline">
                  Ta bort
                </button>
              </td>
            </tr>
          ))}
          {expenses.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-4 text-sm text-gray-500">Inga utlägg registrerade</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
