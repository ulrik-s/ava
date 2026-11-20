"use client";

import { useVatDisplay } from "@/lib/client/vat/vat-display-context";

/** Rubriken över fakturans belopp följer den globala momsväxlingen (#1726),
 *  som `Row` i avräkningsdialogen — beloppet under visas via `<Money>`. */
export function AmountHeading() {
  const { mode } = useVatDisplay();
  return <p className="text-xs text-gray-500">{mode === "incl" ? "Belopp inkl. moms" : "Belopp exkl. moms"}</p>;
}
