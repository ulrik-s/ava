/**
 * Avpricknings-peer för inkomna betalningar (#245, ADR 0005 fas 2 + ADR 0011).
 *
 * Kör som en `PeerAct` i server-runtime:ns pull→act→push-cykel: varje tick
 * hämtas inkomna kundbetalningar via PORTEN (`pullPayments` på en pullPayments-
 * capable connector, t.ex. [[bank-file-connector]]) och prickas av mot öppna
 * fakturor via OCR ([[reconcile-payments]]). Träffar bokförs via
 * `invoice.recordPayment`.
 *
 * IDEMPOTENT (ADR 0005-invarianten): betalningens `externalId` blir
 * Payment.reference; redan bokförda referenser hoppas över → ofarligt att läsa
 * om samma camt-fil varje tick (filerna behöver inte flyttas). Inget att pricka
 * av → ingen mutation → no-empty-commit-grinden (#80) pushar inget.
 */

import type { PeerJob } from "../../local-first/peer-loop";
import type { LedgerConnector, PullPaymentsQuery } from "./port";
import { reconcileLedgerPayments, type ReconcileInvoice, type ReconciledPayment } from "./reconcile-payments";

/** Den delmängd av en faktura-rad avprickningen behöver. */
export interface PayableInvoice {
  id: string;
  ocrReference?: string | null;
  payments?: ReadonlyArray<{ reference?: string | null }>;
}

/** Den delmängd av tRPC-callern jobbet använder. */
export interface PaymentsJobCaller {
  invoice: {
    list: (input: Record<string, never>) => Promise<PayableInvoice[]>;
    recordPayment: (input: {
      invoiceId: string;
      amount: number;
      paidAt: string;
      note?: string;
      reference?: string;
    }) => Promise<unknown>;
  };
}

export interface PaymentsJobDeps {
  /** Bygg en pullPayments-capable connector för cykeln. `null` = ej konfigurerad. */
  loadConnector: () => Promise<LedgerConnector | null>;
  /** Hämta betalningar från och med detta datum (`YYYY-MM-DD`); default epoch. */
  since?: () => string;
  /** Klocka för paidAt-fallback när betalningen saknar datum. */
  clock?: () => Date;
  log?: (msg: string) => void;
}

export interface ReconcileResult {
  recorded: number;
  unmatched: number;
}

/** En connector vars `pullPayments` är garanterat närvarande (capability-grindad). */
type PullCapableConnector = LedgerConnector & Required<Pick<LedgerConnector, "pullPayments">>;

function toCandidates(invoices: readonly PayableInvoice[]): ReconcileInvoice[] {
  return invoices.map((inv) => ({
    id: inv.id,
    ocrReference: inv.ocrReference ?? null,
    paymentReferences: (inv.payments ?? [])
      .map((p) => p.reference)
      .filter((r): r is string => Boolean(r)),
  }));
}

/** Hämta + grinda connectorn på pullPayments-capabilityn. */
async function resolvePullConnector(
  deps: PaymentsJobDeps,
  log: (msg: string) => void,
): Promise<PullCapableConnector | null> {
  const connector = await deps.loadConnector();
  if (!connector) {
    log("Avprickning: ingen betalnings-connector konfigurerad — hoppar över");
    return null;
  }
  if (!connector.capabilities().pullPayments || !connector.pullPayments) {
    log(`Ledger-connector "${connector.name}" saknar pullPayments-capability — hoppar över`);
    return null;
  }
  return connector as PullCapableConnector;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Bokför varje avprickad betalning via callern (idempotent på reference). */
async function recordAll(
  caller: PaymentsJobCaller,
  bookable: readonly ReconciledPayment[],
  fallbackDate: string,
): Promise<void> {
  for (const p of bookable) {
    await caller.invoice.recordPayment({
      invoiceId: p.invoiceId,
      amount: p.amountOre,
      paidAt: p.date ?? fallbackDate,
      note: p.payerName ? `Bankfil-avprickning — ${p.payerName}` : "Bankfil-avprickning",
      reference: p.reference,
    });
  }
}

/**
 * Hämta inkomna betalningar via porten och pricka av mot öppna fakturor.
 * Idempotent: redan bokförda referenser hoppas över.
 */
export async function reconcilePulledPayments(
  caller: PaymentsJobCaller,
  deps: PaymentsJobDeps,
): Promise<ReconcileResult> {
  const log = deps.log ?? (() => {});
  const connector = await resolvePullConnector(deps, log);
  if (!connector) return { recorded: 0, unmatched: 0 };

  const query: PullPaymentsQuery = { since: deps.since?.() ?? "1970-01-01" };
  const payments = await connector.pullPayments(query);
  const invoices = await caller.invoice.list({});
  const outcome = reconcileLedgerPayments(payments, toCandidates(invoices));

  const fallbackDate = isoDate((deps.clock ?? (() => new Date()))());
  await recordAll(caller, outcome.bookable, fallbackDate);

  if (outcome.bookable.length || outcome.unmatched.length) {
    log(`Avprickning: ${outcome.bookable.length} bokförda, ${outcome.unmatched.length} till granskning`);
  }
  return { recorded: outcome.bookable.length, unmatched: outcome.unmatched.length };
}

/** Paketera avprickningen som ett `PeerJob` för server-runtime:ns peer-loop. */
export function makeLedgerPaymentsJob(deps: PaymentsJobDeps): PeerJob {
  return {
    message: "chore(payments): pricka av inkomna betalningar (bankfil)",
    act: async (caller) => {
      await reconcilePulledPayments(caller as unknown as PaymentsJobCaller, deps);
    },
  };
}
