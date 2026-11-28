/**
 * När en faktura är förfallen (#1731) — EN regel för fakturalistan och "Att bevaka".
 *
 * Förfallen = status Skickad eller Avbetalningsplan, obetalt belopp kvar
 * (belopp minus betalningar > 0) och förfallodagen passerad, räknat i svensk
 * kalenderdag. Förr stod villkoren i watchlist-routern; nu läser båda härifrån,
 * så att listan och bevakningen aldrig kan säga olika saker.
 */

import { daysBetween } from "../watchlist";
import { isLive } from "./invoice-state-machine";

/** Fakturans fält som regeln läser. Datum kan vara Date eller ISO-sträng. */
export interface OverdueCandidate {
  status: string;
  dueDate?: Date | string | null | undefined;
  amount: number;
  payments?: readonly { amount: number }[] | null | undefined;
}

/** Obetalt belopp (öre): fakturans belopp minus registrerade betalningar. */
export function outstandingOre(inv: OverdueCandidate): number {
  return inv.amount - (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
}

/**
 * Antal hela svenska kalenderdagar efter förfallodagen, eller `null` om
 * fakturan inte är förfallen (fel status, betald, ingen förfallodag eller
 * förfallodagen är i dag eller senare).
 */
export function overdueDays(inv: OverdueCandidate, now: Date): number | null {
  if (!isLive(inv.status) || inv.dueDate == null) return null;
  if (outstandingOre(inv) <= 0) return null;
  const days = daysBetween(new Date(inv.dueDate), now);
  return days > 0 ? days : null;
}

/** Fakturans röda markeringar i fakturalistan. */
export interface InvoiceAttention {
  /** Dagar efter förfallodagen, eller null om fakturan inte är förfallen. */
  overdueDays: number | null;
  /** Ett utskick av fakturan misslyckades (status `failed`). */
  failedDispatch: boolean;
}

/** Markeringarna för en faktura, givet id:na för fakturor med misslyckat utskick. */
export function invoiceAttention(
  inv: OverdueCandidate & { id: string }, failedInvoiceIds: ReadonlySet<string>, now: Date,
): InvoiceAttention {
  return { overdueDays: overdueDays(inv, now), failedDispatch: failedInvoiceIds.has(inv.id) };
}

/** Om fakturan har någon röd markering. */
export function needsAttention(a: InvoiceAttention): boolean {
  return a.overdueDays !== null || a.failedDispatch;
}
