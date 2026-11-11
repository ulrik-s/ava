"use client";

/**
 * Rättshjälpens takvarning där man arbetar i ärendet (#1520): i ärendehuvudet
 * (oavsett vilken panel som är öppen) och i tidssektionen. Bara rättshjälp:
 * rättsskyddets varning visas som förut bara i panelen Betalningssätt.
 * Självstängande som `InsuranceReferenceField` — null för andra betalningssätt.
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
