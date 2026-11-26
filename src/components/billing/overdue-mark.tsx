/**
 * Den röda markeringen "Förfallen N dagar" (#1731), utbruten ur fakturalistan
 * (#2136) så att fakturalistan och Avbetalningar ritar den likadant.
 */

import { dagar } from "@/lib/shared/watchlist";

/** Klassen för listornas röda markeringar efter statusmärket. */
export const MARK_CLASS = "text-[10px] rounded-full px-2 py-0.5 font-medium bg-red-100 text-red-700";

/** "Förfallen 1 dag" / "Förfallen N dagar". */
export function OverdueMark({ days }: { days: number }) {
  return <span className={`ml-1 ${MARK_CLASS}`}>Förfallen {dagar(days)}</span>;
}
