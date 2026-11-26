"use client";

import { chargedVatOre, expenseNetOre } from "@/lib/shared/expense-vat";
import { formatKr } from "@/lib/shared/kr-format";

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
      Debiteras: {formatKr(netOre)} · moms {passThrough ? "0 %" : "25 %"}: {formatKr(vatOre)}
      {" · inkl: "}{formatKr(netOre + vatOre)}
    </span>
  );
}
