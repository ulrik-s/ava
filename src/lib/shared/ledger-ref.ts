/**
 * Verifikatets referens i bokföringssystemet: EN läsregel för alla läsare (#1931).
 *
 * Referensen är verifikatets id hos bokföringsleverantören, satt på en faktura
 * eller en inbetalning när den har bokförts. Den skrivs en gång och skrivs
 * aldrig över (`markFortnoxBooked` och `bookInvoice` är idempotenta), så
 * reserven nedan kan aldrig ge ett annat verifikat än det som redan gällde.
 *
 * Fältet byter namn från `fortnoxId` till det leverantörsneutrala `ledgerRef`
 * (ADR 0011). Rader som äldre kod har skrivit, och klientens cache före nästa
 * hämtning, bär bara det gamla namnet. Reserven till `fortnoxId` är en
 * övergång (ADR 0038 §2, §6) som tas bort när inga äldre klienter finns kvar.
 *
 * En tom sträng räknas som saknad, som `!fortnoxId` gjorde förut.
 */

/** En rad som kan bära verifikatets referens, under det nya eller det gamla namnet. */
export interface LedgerRefRow {
  readonly ledgerRef?: string | null | undefined;
  readonly fortnoxId?: unknown;
}

const present = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Verifikatets referens: `ledgerRef`, annars `fortnoxId`, annars `null` (obokförd). */
export function ledgerRefOf(row: LedgerRefRow): string | null {
  if (present(row.ledgerRef)) return row.ledgerRef;
  return present(row.fortnoxId) ? row.fortnoxId : null;
}
