/**
 * Fakturornas tillståndsmaskin (#350, [ADR 0015]). EN sanningskälla för vilka
 * status-övergångar som är tillåtna — alla kodvägar (`setStatus`,
 * `recordPayment`, `createPaymentPlan`, `cancelPaymentPlan`, kreditering,
 * `writeOff`) ska gå igenom `canTransition`/`assertInvoiceTransition` så att
 * **omöjliga tillstånd inte kan uppstå** (t.ex. `PAID` utan att ha passerat
 * `SENT`, eller en `DRAFT` med registrerad betalning).
 *
 * Ren logik, inga DB-anrop — delas av server (routrar, seed) och tester.
 *
 * Invarianter:
 *   - `PAID`/`INSTALLMENT_PLAN`/`BAD_DEBT` nås BARA via `SENT` (eller via
 *     varandra) — aldrig direkt från `DRAFT`.
 *   - `DRAFT` kan bara skickas (`SENT`) eller annulleras (`CANCELLED`).
 *   - `CANCELLED` är terminalt.
 *   - Kreditering annullerar originalet → `* → CANCELLED` tillåts från alla
 *     icke-terminala tillstånd.
 *   - Samma-tillstånd (`from === to`) är alltid en no-op-övergång (idempotens).
 *
 * [ADR 0015]: ../../../docs/adr/0015-faktura-tillstandsmaskin.md
 */

import type { InvoiceStatus } from "@/lib/shared/schemas/enums";

/**
 * Tillåtna övergångar per tillstånd (exkl. den implicita `from === to`).
 * Se diagrammet i [ADR 0015].
 */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  // Utkast: skicka eller annullera.
  DRAFT: ["SENT", "CANCELLED"],
  // Skickad: full betalning → PAID, delbetalning + plan → INSTALLMENT_PLAN,
  // avskrivning → BAD_DEBT, annullera/kreditera → CANCELLED.
  SENT: ["PAID", "INSTALLMENT_PLAN", "BAD_DEBT", "CANCELLED"],
  // Avbetalningsplan: slutbetald → PAID, avbruten plan → SENT, avskrivning →
  // BAD_DEBT, kreditera → CANCELLED.
  INSTALLMENT_PLAN: ["PAID", "SENT", "BAD_DEBT", "CANCELLED"],
  // Betald: kan krediteras (→ CANCELLED). Sen avskrivning förekommer inte.
  PAID: ["CANCELLED"],
  // Kundförlust: en sen inbetalning kan återuppliva (→ PAID, ledger-härlett),
  // eller krediteras (→ CANCELLED).
  BAD_DEBT: ["PAID", "CANCELLED"],
  // Annullerad är terminalt.
  CANCELLED: [],
};

/** Tillstånd som BARA får nås efter att fakturan passerat `SENT`. */
export const REQUIRES_SENT: readonly InvoiceStatus[] = ["PAID", "INSTALLMENT_PLAN", "BAD_DEBT"];

/** Är `to` en laglig efterföljare till `from`? Samma tillstånd = alltid ok. */
export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  return INVOICE_TRANSITIONS[from].includes(to);
}

/** Människoläsbart fel för en otillåten övergång (för router-/UI-meddelanden). */
export function transitionErrorMessage(from: InvoiceStatus, to: InvoiceStatus): string {
  return `Ogiltig faktura-övergång: ${from} → ${to}. Tillåtna från ${from}: ` +
    `${[from, ...INVOICE_TRANSITIONS[from]].join(", ")}.`;
}

/** Kasta vid otillåten övergång (plain Error — routern wrappar till TRPCError). */
export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) throw new Error(transitionErrorMessage(from, to));
}
