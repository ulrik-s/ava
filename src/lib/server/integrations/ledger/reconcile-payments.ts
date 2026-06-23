/**
 * Avprickning av flata `LedgerPayment` mot AVA-fakturor (#245, ADR 0011).
 *
 * Server-runtime-peern hämtar inkomna betalningar via PORTEN
 * (`pullPayments` → vendor-neutral flat `LedgerPayment`) och prickar av dem mot
 * öppna fakturor. Vendor-neutral nyckel = OCR-referensen (mod-10), så denna
 * matchare är medvetet enklare än den rika camt-motorn ([[match-payments]]) som
 * driver den manuella importsidan (flera referenser/delbelopp/fri text). Den
 * flata vägen passar automatiska källor (bankfil-inkorg, Fortnox invoicepayments)
 * där varje betalning bär en OCR-referens.
 *
 * Idempotent: en betalnings `externalId` blir Payment.reference; betalningar vars
 * externalId redan finns bland fakturornas betalningar hoppas över (dubblett).
 * Ren funktion, inget I/O.
 */

import { normalizeRef } from "@/lib/shared/payments/match-payments";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import type { LedgerPayment } from "./port";

/** Faktura-delmängd avprickningen behöver. */
export interface ReconcileInvoice {
  id: InvoiceId;
  ocrReference: string | null;
  /** Referenser på redan bokförda betalningar (Payment.reference) — dubblettskydd. */
  paymentReferences: readonly string[];
}

/** En avprickningsbar betalning (matchad mot en faktura). */
export interface ReconciledPayment {
  invoiceId: InvoiceId;
  amountOre: number;
  /** Idempotens-referens (= LedgerPayment.externalId). */
  reference: string;
  /** Betalningsdatum `YYYY-MM-DD` om källan angav det. */
  date?: string;
  payerName?: string;
}

export interface UnreconciledPayment {
  payment: LedgerPayment;
  reason: "saknar-ocr" | "ingen-träff" | "dubblett";
}

export interface ReconcileOutcome {
  bookable: ReconciledPayment[];
  unmatched: UnreconciledPayment[];
}

/** OCR-referens (normaliserad) → faktura-id. */
function buildOcrIndex(invoices: readonly ReconcileInvoice[]): Map<string, InvoiceId> {
  const index = new Map<string, InvoiceId>();
  for (const inv of invoices) {
    if (inv.ocrReference) index.set(normalizeRef(inv.ocrReference), inv.id);
  }
  return index;
}

function toReconciled(payment: LedgerPayment, invoiceId: InvoiceId): ReconciledPayment {
  return {
    invoiceId,
    amountOre: payment.amount,
    reference: payment.externalId,
    ...(payment.date ? { date: payment.date } : {}),
    ...(payment.payerName ? { payerName: payment.payerName } : {}),
  };
}

/**
 * Pricka av flata betalningar mot fakturor via OCR-referens. Dubbletter
 * (externalId redan bokfört) och betalningar utan OCR/utan träff hamnar i
 * `unmatched` (granskningskö), aldrig auto-bokade på osäker grund.
 */
export function reconcileLedgerPayments(
  payments: readonly LedgerPayment[],
  invoices: readonly ReconcileInvoice[],
): ReconcileOutcome {
  const ocrIndex = buildOcrIndex(invoices);
  const imported = new Set(invoices.flatMap((i) => i.paymentReferences));
  const bookable: ReconciledPayment[] = [];
  const unmatched: UnreconciledPayment[] = [];

  for (const payment of payments) {
    if (imported.has(payment.externalId)) {
      unmatched.push({ payment, reason: "dubblett" });
    } else if (!payment.ocrReference) {
      unmatched.push({ payment, reason: "saknar-ocr" });
    } else {
      const invoiceId = ocrIndex.get(normalizeRef(payment.ocrReference));
      if (invoiceId) bookable.push(toReconciled(payment, invoiceId));
      else unmatched.push({ payment, reason: "ingen-träff" });
    }
  }
  return { bookable, unmatched };
}
