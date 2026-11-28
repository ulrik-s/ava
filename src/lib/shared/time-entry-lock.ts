/**
 * Låsta tidsposter och utlägg (#1205, #1862) — EN regel för vad som redan är
 * redovisat eller fakturerat och därför aldrig får räknas in i en ny
 * kostnadsräkning, slutreglering, slutfaktura eller ett aconto-förslag.
 *
 * En post är låst när något av de tre fälten i `BILLING_LOCK_FIELDS` är satt:
 * - `invoiceId`: posten är fakturerad på en faktura,
 * - `frozenAt`: posten är fryst — av en körning, eller direkt mot en faktura
 *   utan körning (rättshjälpens rådgivningstimme, som faktureras klienten
 *   direkt efter mötet),
 * - `frozenByBillingRunId`: körningen (slutfaktura/kostnadsräkning) som frös den.
 * Repona (Drizzle och minne, ADR 0020) väljer ur samma fältlista.
 */

import type { BillingRunId } from "./schemas/ids";

/**
 * Fälten som låser en post (#1862). Predikatet `isLockedEntry`, minnesrepots
 * urval (`unlockedMatch`) och Drizzle-villkoret (`unlockedWhere`) byggs alla ur
 * listan, så att ett nytt låsfält inte kan läggas till på bara ett ställe.
 */
export const BILLING_LOCK_FIELDS = ["invoiceId", "frozenAt", "frozenByBillingRunId"] as const;

/** Ett av fälten i `BILLING_LOCK_FIELDS`. */
export type BillingLockField = (typeof BILLING_LOCK_FIELDS)[number];

/** Det en post behöver bära för att låsregeln ska kunna avgöras. */
export interface LockableEntry {
  invoiceId?: string | null | undefined;
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
  return BILLING_LOCK_FIELDS.some((field) => t[field] != null);
}

/**
 * Urvalet "ej låst och ej raderad" för minnesrepona: alla låsfält och
 * `deletedAt` null (Prisma-semantik, där null och ett saknat fält likställs).
 * Samma regel som `isLockedEntry` och Drizzles `unlockedWhere`.
 */
export function unlockedMatch(): Readonly<Record<string, null>> {
  return Object.fromEntries([...BILLING_LOCK_FIELDS, "deletedAt"].map((field) => [field, null]));
}

/**
 * Tooltipen på en låst post i tidslistorna (#1863), med samma lydelse som
 * serverns avvisning av ändring och borttagning.
 */
export const LOCKED_ENTRY_HINT = "Ingår i en faktura eller kostnadsräkning och kan inte ändras eller tas bort.";

/** Knuten till en faktura (`invoiceId` satt), oavsett frysning. */
export function hasInvoice(t: Pick<LockableEntry, "invoiceId">): boolean {
  return t.invoiceId != null;
}

/**
 * Låst direkt mot en faktura, utan körning — rättshjälpens rådgivningstimme
 * (#1205). Den är redan fakturerad klienten och ligger utanför rättshjälpen,
 * så den räknas inte mot täckningstaket (#1210). Poster som frysts av en
 * körning (kostnadsräkning/slutfaktura) är arbete i uppdraget och räknas.
 */
export function isInvoicedOutsideCoverage(t: LockableEntry): boolean {
  return t.frozenAt != null && t.frozenByBillingRunId == null;
}

/**
 * Vad en makulerad eller krediterad faktura släpper (#2260): fakturan och de
 * körningar som skapade den (`billingRunIds`, slutfakturans eller acontots
 * egen körning — aldrig en kostnadsräkning, som står fast hos domstolen).
 */
export interface InvoiceRelease {
  invoiceId: string;
  billingRunIds: readonly BillingRunId[];
}

/** Låsfälten ett släpp nollar på en post (tomt = posten berörs inte). */
export type ReleasePatch = Partial<Record<BillingLockField, null>>;

/**
 * Vilka låsfält ett släpp av fakturan nollar på posten (#2260) — EN regel för
 * minnesrepona och Drizzle-villkoren (`releasedFreezeWhere`):
 * - fakturans egen koppling (`invoiceId`) nollas,
 * - frysningen nollas när en släppt körning frös posten och posten inte hör
 *   till en annan faktura.
 * En post som en kostnadsräkning frös behåller frysningen: den är inskickad
 * till domstolen och står fast.
 */
export function releasePatch(t: LockableEntry, r: InvoiceRelease): ReleasePatch {
  const own = t.invoiceId === r.invoiceId;
  const frozenByReleased = t.frozenByBillingRunId != null && r.billingRunIds.includes(t.frozenByBillingRunId);
  return {
    ...(own ? { invoiceId: null } : {}),
    ...(frozenByReleased && (own || t.invoiceId == null) ? { frozenAt: null, frozenByBillingRunId: null } : {}),
  };
}
