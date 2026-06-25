"use client";

/**
 * Global indikator för moms-visningsläget (#781). Visar om belopp i appen
 * just nu visas inkl. eller exkl. moms, och fungerar som genväg för att
 * växla. Alla belopp (via `<Money>`) följer samma läge.
 */

import { useVatDisplay } from "@/lib/client/vat/vat-display-context";

export function VatModeIndicator() {
  const { mode, toggle } = useVatDisplay();
  const label = mode === "incl" ? "inkl. moms" : "exkl. moms";
  return (
    <button
      type="button"
      onClick={toggle}
      title="Växla om belopp visas inkl. eller exkl. moms (gäller hela appen)"
      className="fixed top-2 right-2 z-40 rounded-full border border-gray-300 bg-white/90 px-3 py-1 text-xs font-medium text-gray-700 shadow-sm backdrop-blur hover:bg-gray-50"
    >
      Belopp: {label} ▾
    </button>
  );
}
