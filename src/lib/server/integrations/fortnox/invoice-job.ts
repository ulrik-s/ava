/**
 * Fortnox-connectorns peer-job (#82, ADR 0005 fas 2).
 *
 * Kör som en `PeerAct` i server-runtime:ns konflikt-säkra pull→act→push-cykel:
 * varje tick listas fakturorna i git-db:n, de som ännu inte bokförts
 * (`fortnoxId` saknas) byggs till balanserade verifikat och pushas till
 * Fortnox Voucher API; vid lyckad push skrivs `fortnoxId` tillbaka på raden.
 *
 * IDEMPOTENT (ADR 0005-invarianten): bokningskandidaten är "saknar fortnoxId".
 * Så fort ett verifikat skapats märks fakturan (`markFortnoxBooked`), och en
 * omkörd cykel hoppar över den → ingen dubbelbokföring. Konto-mappningen läses
 * ur firma.git (#217); saknas den vägrar connectorn boka (completeness-gate).
 */

import { buildSemanticVoucher, type SemanticVoucherInput } from "@/lib/shared/accounting/semantic-voucher";
import { DEFAULT_VAT_RATE, type VatRate } from "@/lib/shared/vat";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";
import type { PeerJob } from "../../local-first/peer-loop";
import type { LedgerConnector } from "../ledger/port";

/** Endast verifikat på UTFÄRDADE fakturor; DRAFT/CANCELLED/BAD_DEBT bokförs ej här. */
export const DEFAULT_BOOKABLE_STATUSES: readonly InvoiceStatus[] = ["SENT", "PAID", "INSTALLMENT_PLAN"];

/** Den delmängd av en faktura-rad sync-drivern behöver. */
export interface BookableInvoice extends SemanticVoucherInput {
  id: string;
  status: InvoiceStatus;
  fortnoxId?: string | null;
}

/** Den delmängd av tRPC-callern connectorn använder (resten av grafen ignoreras). */
export interface FortnoxJobCaller {
  invoice: {
    list: (input: Record<string, never>) => Promise<BookableInvoice[]>;
    markFortnoxBooked: (input: { invoiceId: string; fortnoxId: string }) => Promise<unknown>;
  };
}

export interface FortnoxInvoiceJobDeps {
  /**
   * Bygg ledger-connectorn för den aktuella cykeln (läser färsk konto-mappning
   * ur firma.git, #217). `null` = ej konfigurerad → boka inget (completeness-
   * gate). Drivern jobbar mot PORTEN, inte mot Fortnox direkt (ADR 0011).
   */
  loadConnector: () => Promise<LedgerConnector | null>;
  vatRate?: VatRate;
  bookableStatuses?: readonly InvoiceStatus[];
  log?: (msg: string) => void;
}

export interface BookResult {
  booked: number;
  failed: number;
  skipped: number;
}

function isPending(inv: BookableInvoice, bookable: ReadonlySet<InvoiceStatus>): boolean {
  return !inv.fortnoxId && bookable.has(inv.status);
}

/** Bygg semantiskt verifikat, pusha via porten och märk fakturan bokförd. */
async function bookOne(
  caller: FortnoxJobCaller,
  connector: PushCapableConnector,
  inv: BookableInvoice,
  vatRate: VatRate,
): Promise<void> {
  const voucher = buildSemanticVoucher(inv, vatRate);
  const { externalId } = await connector.pushVoucher(voucher, { idempotencyKey: inv.id });
  await caller.invoice.markFortnoxBooked({ invoiceId: inv.id, fortnoxId: externalId });
}

/** En connector vars `pushVoucher` är garanterat närvarande (capability-grindad). */
type PushCapableConnector = LedgerConnector & Required<Pick<LedgerConnector, "pushVoucher">>;

/**
 * Bygg connectorn för cykeln och grinda på pushVoucher-capabilityn. null när
 * connectorn saknas (ej konfigurerad) eller inte kan boka verifikat.
 */
async function resolvePushConnector(
  deps: FortnoxInvoiceJobDeps,
  log: (msg: string) => void,
): Promise<PushCapableConnector | null> {
  const connector = await deps.loadConnector();
  if (!connector) {
    log("Fortnox: ingen connector/konto-mappning (settings/fortnox-account-map.json) — hoppar över");
    return null;
  }
  if (!connector.capabilities().pushVoucher || !connector.pushVoucher) {
    log(`Ledger-connector "${connector.name}" saknar pushVoucher-capability — hoppar över`);
    return null;
  }
  return connector as PushCapableConnector;
}

interface BookContext {
  caller: FortnoxJobCaller;
  connector: PushCapableConnector;
  vatRate: VatRate;
  log: (msg: string) => void;
}

/** Bokför varje kandidat; ett fel stoppar inte resten (loggas + räknas). */
async function bookEach(
  pending: readonly BookableInvoice[],
  ctx: BookContext,
): Promise<{ booked: number; failed: number }> {
  let booked = 0;
  let failed = 0;
  for (const inv of pending) {
    try {
      await bookOne(ctx.caller, ctx.connector, inv, ctx.vatRate);
      booked += 1;
    } catch (err) {
      failed += 1;
      ctx.log(`Fortnox: kunde inte boka faktura ${inv.id}: ${String(err)}`);
    }
  }
  return { booked, failed };
}

/**
 * Bokför alla ännu obokförda, utfärdade fakturor. Idempotent: kandidaten är
 * "saknar fortnoxId", och varje lyckad push märks direkt (`markFortnoxBooked`).
 */
export async function bookUnsyncedInvoices(
  caller: FortnoxJobCaller,
  deps: FortnoxInvoiceJobDeps,
): Promise<BookResult> {
  const log = deps.log ?? (() => {});
  const connector = await resolvePushConnector(deps, log);
  if (!connector) return { booked: 0, failed: 0, skipped: 0 };

  const bookable = new Set<InvoiceStatus>(deps.bookableStatuses ?? DEFAULT_BOOKABLE_STATUSES);
  const invoices = await caller.invoice.list({});
  const pending = invoices.filter((inv) => isPending(inv, bookable));
  const { booked, failed } = await bookEach(pending, {
    caller,
    connector,
    vatRate: deps.vatRate ?? DEFAULT_VAT_RATE,
    log,
  });

  const skipped = invoices.length - pending.length;
  if (booked || failed) log(`Fortnox: bokförde ${booked} verifikat (${failed} fel, ${skipped} hoppade)`);
  return { booked, failed, skipped };
}

/** Paketera connectorn som ett `PeerJob` för server-runtime:ns peer-loop. */
export function makeFortnoxInvoiceJob(deps: FortnoxInvoiceJobDeps): PeerJob {
  return {
    message: "chore(fortnox): bokför nya fakturor som verifikat",
    act: async (caller) => {
      // PeerAct ger hela tRPC-callern; connectorn använder bara en strukturell
      // delmängd (invoice.list + markFortnoxBooked) — isolerad cast i gränsen.
      await bookUnsyncedInvoices(caller as unknown as FortnoxJobCaller, deps);
    },
  };
}
