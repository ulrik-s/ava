/**
 * Fakturapanelens summa-kort (#819, #1236) — ren beräkning, ingen I/O.
 *
 * De fyra korten ska tillsammans täcka ärendets pengar utan dubbelräkning:
 *   - **Yrkat i kostnadsräkning**: Σ yrkat belopp på aktiva kostnadsräkningar
 *     (inskickad / beslutad / överklagad — ej fakturerad eller ångrad). När
 *     fakturan skapas blir KR:n FAKTURERAD och beloppet flyttar till Fakturerat.
 *   - **Fakturerat**: alla fakturor utom annullerade. En faktura som annullerats
 *     AV en kreditering räknas ändå, så kreditnotan nettar den till noll (i
 *     stället för att dras av två gånger). Skapade men ej skickade (DRAFT)
 *     ingår och redovisas separat som `draftOre`.
 *   - **Betalt**: Σ registrerade betalningar.
 *
 * Alla belopp här är BRUTTO (inkl moms), öre: fakturornas `amount` och
 * KR-körningens `amountOre` (= `krGrossOre`, det yrkade inkl moms).
 */

import { creditedInvoiceIds } from "./ar-summary";
import { isActiveKr, type TodoRun } from "./billing-todo";
import type { InvoiceStatus, InvoiceType } from "./schemas/enums";
import type { InvoiceId } from "./schemas/ids";

/** Det summan läser ur en billing-run: predikat-fälten + det lagrade beloppet. */
export type SummaryRun = TodoRun & { amountOre: number };

/** Det summan läser ur en faktura (invoice.list-raden passar). Typ-alias — inte
 *  interface — så att raden är tilldelbar till `creditedInvoiceIds` rad-typ. */
export type SummaryInvoice = {
  id: InvoiceId;
  amount: number;
  status: InvoiceStatus;
  invoiceType?: InvoiceType | null | undefined;
  creditedInvoiceId?: InvoiceId | null | undefined;
  payments?: ReadonlyArray<{ amount: number }> | null | undefined;
};

/** Fakturerat-kortets tal: totalen och hur mycket av den som ännu inte skickats. */
export interface InvoicedTotals {
  /** Σ fakturor utom annullerade (kreditnotor nettar sin ursprungsfaktura). */
  invoicedOre: number;
  /** Andelen av `invoicedOre` som är skapad men ej skickad (DRAFT). */
  draftOre: number;
}

/** Σ yrkat (brutto) på kostnadsräkningar som ännu inte fakturerats. */
export function krClaimedOre(runs: readonly SummaryRun[]): number {
  return runs.filter(isActiveKr).reduce((s, r) => s + r.amountOre, 0);
}

/** Fakturerat inkl skapade-ej-skickade; annullerade utan kreditering räknas ej. */
export function invoicedTotals(invoices: readonly SummaryInvoice[]): InvoicedTotals {
  const credited = creditedInvoiceIds(invoices);
  const counted = invoices.filter((i) => i.status !== "CANCELLED" || credited.has(i.id));
  const sum = (rows: readonly SummaryInvoice[]): number => rows.reduce((s, i) => s + i.amount, 0);
  return { invoicedOre: sum(counted), draftOre: sum(counted.filter((i) => i.status === "DRAFT")) };
}

/** Σ registrerade betalningar på fakturorna. */
export function paidOre(invoices: readonly SummaryInvoice[]): number {
  return invoices.reduce((s, i) => s + (i.payments ?? []).reduce((p, pm) => p + pm.amount, 0), 0);
}
