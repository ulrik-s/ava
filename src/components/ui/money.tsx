"use client";

/**
 * `<Money>` — visar ett penningbelopp och låter användaren **klicka för att
 * växla** mellan inkl./exkl. moms (#781). Växlingen är global (alla belopp
 * följer samma läge, se `useVatDisplay`).
 *
 * `basis` säger vad det lagrade `ore`-talet representerar idag:
 *   - "net"   → talet är exkl. moms (målmodellen; default)
 *   - "gross" → talet är inkl. moms (faktura/utlägg tills lagringen
 *               migrerats i #782)
 * Komponenten räknar fram motsvarande inkl/exkl via `splitVat`.
 */

import { formatCurrency } from "@/lib/client/utils";
import { useVatDisplay } from "@/lib/client/vat/vat-display-context";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/shared/vat";

interface Props {
  /** Beloppet i öre, tolkat enligt `basis`. */
  ore: number;
  /** Vad `ore` representerar idag. Default "net" (exkl. moms). */
  basis?: "net" | "gross";
  /** Moms-sats i basis points. Default 25 %. */
  vatRate?: number;
  className?: string;
}

export function Money({ ore, basis = "net", vatRate = DEFAULT_VAT_RATE, className }: Props) {
  const { mode, toggle } = useVatDisplay();
  const split = splitVat({ amount: ore, vatRate, vatIncluded: basis === "gross" });
  const shown = mode === "incl" ? split.inclVat : split.exclVat;
  return (
    <button
      type="button"
      onClick={toggle}
      title={`Visar ${mode === "incl" ? "inkl." : "exkl."} moms — klicka för att växla`}
      className={`cursor-pointer underline decoration-dotted decoration-gray-300 underline-offset-2 hover:decoration-gray-500 ${className ?? ""}`}
    >
      {formatCurrency(shown)}
    </button>
  );
}
