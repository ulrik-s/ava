/**
 * `VatBreakdown` — visar moms-uppdelningen för ett inkl-moms-belopp så det
 * tydligt framgår vad som är moms respektive netto (#778). Advokattjänster
 * = 25 %. Returnerar null för 0/negativa belopp.
 */

import { formatCurrency } from "@/lib/client/utils";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/shared/vat";

export function VatBreakdown({ inclOre }: { inclOre: number }) {
  if (inclOre <= 0) return null;
  const { exclVat, vat } = splitVat({ amount: inclOre, vatRate: DEFAULT_VAT_RATE, vatIncluded: true });
  return (
    <p className="mt-1 text-[11px] text-gray-500">
      Varav moms (25 %): <span className="font-mono">{formatCurrency(vat)}</span>
      {" · "}exkl. moms: <span className="font-mono">{formatCurrency(exclVat)}</span>
    </p>
  );
}
