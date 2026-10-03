/**
 * `VatBreakdown` — visar moms-uppdelningen för ett inkl-moms-belopp så det
 * tydligt framgår vad som är moms respektive netto (#778). Advokattjänster
 * = 25 %. Returnerar null för 0/negativa belopp.
 */

import { formatCurrency } from "@/lib/client/utils";
import { DEFAULT_VAT_RATE } from "@/lib/shared/vat";
import { splitGross } from "@/lib/shared/whole-kronor";

export function VatBreakdown({ inclOre }: { inclOre: number }) {
  if (inclOre <= 0) return null;
  // Samma uppdelning som fakturan (#1438): nettot i hela kronor, momsen resten.
  const { netOre: exclVat, vatOre: vat } = splitGross(inclOre, DEFAULT_VAT_RATE);
  return (
    <p className="mt-1 text-[11px] text-gray-500">
      Varav moms (25 %): <span className="font-mono">{formatCurrency(vat)}</span>
      {" · "}exkl. moms: <span className="font-mono">{formatCurrency(exclVat)}</span>
    </p>
  );
}
