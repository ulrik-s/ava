/**
 * Val av fakturans poster på datumintervall (#1888) — ren funktion delad av
 * postlistan i fakturadialogen (och senare kostnadsräkningens dialoger).
 *
 * En kalenderdag är dagen i Stockholm (#1677): en post 23:30 UTC hör till
 * nästa svenska dag.
 */

import { stockholmDay } from "../stockholm-time";

/** En post med datum — tidspost eller utlägg. */
export interface DatedPost {
  date: Date | string;
}

/**
 * Posterna vars svenska kalenderdag ligger inom `from`–`to` ("YYYY-MM-DD").
 * Båda gränserna ingår; ett tomt fält är öppet åt det hållet, så två tomma
 * fält ger alla poster.
 */
export function postsInDateRange<T extends DatedPost>(rows: readonly T[], from: string, to: string): T[] {
  return rows.filter((row) => {
    const day = stockholmDay(new Date(row.date));
    return (from === "" || day >= from) && (to === "" || day <= to);
  });
}
