/**
 * Låsta tidsposter (#1205) — EN regel för vad som redan är redovisat eller
 * fakturerat och därför aldrig får räknas in i en ny kostnadsräkning,
 * slutreglering eller ett aconto-förslag.
 *
 * En post är låst när den antingen frysts av en fakturerings-körning
 * (`frozenByBillingRunId`: slutfaktura/kostnadsräkning) eller låsts direkt mot
 * en faktura (`frozenAt` utan körning: rättshjälpens rådgivningstimme, som
 * faktureras klienten direkt efter mötet). Servern speglar samma regel i
 * `listUnfrozenForMatter`/`freezeForMatter`.
 */

import type { BillingRunId } from "./schemas/ids";

/** Det en post behöver bära för att låsregeln ska kunna avgöras. */
export interface LockableEntry {
  frozenAt?: Date | string | null | undefined;
  frozenByBillingRunId?: BillingRunId | null | undefined;
}

/**
 * Är posten låst för ett nytt underlag? `ownRunId` = körningen underlaget hör
 * till: poster som just DEN körningen frös är dess eget underlag (t.ex. KR-
 * dokumentet som genereras direkt efter att kostnadsräkningen skickats in) och
 * räknas inte som låsta.
 */
export function isLockedEntry(t: LockableEntry, ownRunId?: BillingRunId): boolean {
  if (ownRunId !== undefined && t.frozenByBillingRunId === ownRunId) return false;
  return t.frozenAt != null || t.frozenByBillingRunId != null;
}
