/**
 * `bookUnbookedPayments` — inbetalningar som verifikat (#1173).
 *
 * Samma mönster som `bookUnbookedInvoices`: kandidaten ÄR "saknar externt id",
 * write-back direkt efter lyckad push, fel per betalning i st.f. att kasta.
 * Betalningarna bokförs först när fakturan är bokförd — annars krediteras en
 * kundfordran som aldrig debiterats.
 */

import { buildPaymentVoucher } from "@/lib/shared/accounting/semantic-voucher";
import type { LedgerConnector } from "./port";

export interface BookablePayment {
  id: string;
  amount: number;
  paidAt: Date | string;
  fortnoxId?: string | null | undefined;
}

export interface PaymentBookingOutcome {
  paymentId: string;
  externalId: string | null;
  error: string | null;
}

export interface BookPaymentsDeps<P extends BookablePayment = BookablePayment> {
  payments: readonly P[];
  invoice: { invoiceNumber: string | null; matterNumber: string | null };
  connector: Pick<LedgerConnector, "pushVoucher" | "capabilities">;
  markBooked: (payment: P, externalId: string) => Promise<unknown>;
}

async function bookOne<P extends BookablePayment>(p: P, deps: BookPaymentsDeps<P>): Promise<PaymentBookingOutcome> {
  try {
    const push = deps.connector.pushVoucher;
    if (!deps.connector.capabilities().pushVoucher || !push) throw new Error("Ledger-connectorn saknar pushVoucher-kapabilitet.");
    const voucher = buildPaymentVoucher({ amount: p.amount, paidAt: p.paidAt, ...deps.invoice });
    const res = await push.call(deps.connector, voucher, { idempotencyKey: p.id });
    await deps.markBooked(p, res.externalId);
    return { paymentId: p.id, externalId: res.externalId, error: null };
  } catch (e) {
    return { paymentId: p.id, externalId: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Bokför alla obokförda betalningar, i betalningsordning (äldst först). */
export async function bookUnbookedPayments<P extends BookablePayment>(deps: BookPaymentsDeps<P>): Promise<PaymentBookingOutcome[]> {
  const pending = deps.payments
    .filter((p) => !p.fortnoxId)
    .sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());
  const outcomes: PaymentBookingOutcome[] = [];
  for (const p of pending) outcomes.push(await bookOne(p, deps));
  return outcomes;
}
