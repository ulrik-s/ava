"use client";

/**
 * Rättshjälpens takvarning i tidssektionen (#1520). Bara rättshjälp: rättsskyddets
 * varning visas i ärendehuvudet och i betalningsdialogen, som visar den delade
 * `CoverageCapWarning` direkt för båda betalningssätten (#1499, #1732).
 * Självstängande som försäkringsreferensen i `MatterHeaderDetails` — null för
 * andra betalningssätt.
 */

import { CoverageCapWarning, type CoverageCapLayout } from "@/components/matter/coverage-cap-warning";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";

export function RattshjalpCapWarning({ matterId, paymentMethod, rattshjalpMaxTimmar, layout }: {
  matterId: MatterId;
  paymentMethod: PaymentMethod | null | undefined;
  /** Rättshjälpens timtak (null/saknas → standardtaket 100 tim). */
  rattshjalpMaxTimmar: number | null | undefined;
  layout?: CoverageCapLayout;
}) {
  if (paymentMethod !== "RATTSHJALP") return null;
  return (
    <CoverageCapWarning matterId={matterId} paymentMethod={paymentMethod} rattsskyddMaxOre={null}
      rattshjalpMaxTimmar={rattshjalpMaxTimmar ?? null} layout={layout} />
  );
}
