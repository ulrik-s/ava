"use client";

import { formatCurrency } from "@/lib/client/utils";
import { chargedVatOre, expenseNetOre } from "@/lib/shared/expense-vat";

/**
 * Vad KLIENTEN kommer att debiteras (#975) — inte vad byrån betalade. Ett utlägg
 * med 6 % ingående moms debiteras vidare med 25 % på nettot, så förhandsvisningen
 * måste visa den satsen; annars ser juristen ett belopp som inte hamnar på fakturan.
 * Delas av det vanliga utläggsformuläret och milersättningen (#1529).
 */
export function VatPreview({ amount, vatRate, passThrough }: { amount: number; vatRate: number; passThrough: boolean }) {
  if (!amount) return <span className="text-xs text-gray-400">Förhandsvisning</span>;
  const netOre = expenseNetOre({ amount: Math.round(amount * 100), vatRate, vatIncluded: false, passThrough });
  const vatOre = passThrough ? 0 : chargedVatOre(netOre);
  return (
    <span className="text-xs text-gray-600 font-mono">
      Debiteras: {formatCurrency(netOre)} · moms {passThrough ? "0 %" : "25 %"}: {formatCurrency(vatOre)}
      {" · inkl: "}{formatCurrency(netOre + vatOre)}
    </span>
  );
}
