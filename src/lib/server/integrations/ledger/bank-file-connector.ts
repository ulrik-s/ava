/**
 * `BankFileLedgerConnector` — pullPayments via bankfil (#237, ADR 0011).
 *
 * Vendor-neutral avprickningskälla UTAN bankuppkoppling/PSD2: byrån laddar upp
 * sin banks återrapporteringsfil (ISO 20022 camt.053/054) och connectorn
 * parsar inkomna kundbetalningar bakom ledger-porten. Ingen extern integration
 * — bara filinläsning. (BGMAX kan läggas till som en andra parser senare.)
 *
 * Connectorn sluter över sin filkälla (`loadCamtFiles`, injiceras av runtime/
 * UI) precis som Fortnox-connectorn sluter över sin klient. Den mappar varje
 * INBETALNING (CRDT) till portens flata `LedgerPayment`-DTO; den rika camt-
 * matchningen (flera referenser/delbelopp/fri text) ägs av
 * [[match-payments]] och lever vidare som den detaljerade in-app-motorn.
 *
 * Capabilities: bara `pullPayments`.
 */

import { isValidOcrReference } from "@/lib/shared/ocr-reference";
import { parseCamtXml, type CamtTransaction } from "@/lib/shared/payments/camt-parse";
import {
  ledgerPaymentSchema,
  type LedgerCapabilities,
  type LedgerConnector,
  type LedgerPayment,
  type PullPaymentsQuery,
} from "./port";

export interface BankFileConnectorDeps {
  /**
   * Hämta råa camt-XML-filer för intervallet (injiceras av runtime/UI —
   * uppladdade filer eller server-runtime-peer). Tom lista = inga betalningar.
   */
  loadCamtFiles: (query: PullPaymentsQuery) => Promise<ReadonlyArray<string>>;
}

const BANK_FILE_CAPABILITIES: LedgerCapabilities = {
  pushVoucher: false,
  pushInvoice: false,
  pullPayments: true,
  exportSie: false,
};

/** Bästa OCR-kandidat: en strukturerad referens som validerar som OCR (mod-10). */
function ocrOf(tx: CamtTransaction): string | undefined {
  const valid = tx.structuredRefs.find((r) => isValidOcrReference(r.ref));
  return (valid ?? tx.structuredRefs[0])?.ref;
}

/** En CRDT-transaktion → flat LedgerPayment (null om beloppet ej är positivt). */
function toLedgerPayment(tx: CamtTransaction): LedgerPayment | null {
  if (tx.creditDebit !== "CRDT" || tx.amountOre <= 0) return null;
  // Strikt parse vid connector-gränsen ([[feedback-zod-strict-parsing]]).
  return ledgerPaymentSchema.parse({
    externalId: tx.reference,
    amount: tx.amountOre,
    ...(tx.valueDate ? { date: tx.valueDate } : {}),
    ...(ocrOf(tx) ? { ocrReference: ocrOf(tx) } : {}),
    ...(tx.debtorName ? { payerName: tx.debtorName } : {}),
  });
}

export class BankFileLedgerConnector implements LedgerConnector {
  readonly name = "bankfil-camt";

  constructor(private readonly deps: BankFileConnectorDeps) {}

  capabilities(): LedgerCapabilities {
    return BANK_FILE_CAPABILITIES;
  }

  async pullPayments(query: PullPaymentsQuery): Promise<LedgerPayment[]> {
    const files = await this.deps.loadCamtFiles(query);
    const payments: LedgerPayment[] = [];
    const seen = new Set<string>();
    for (const xml of files) {
      for (const tx of parseCamtXml(xml).transactions) {
        const payment = toLedgerPayment(tx);
        // Idempotens vid överlappande filer: dedup på externalId.
        if (payment && !seen.has(payment.externalId)) {
          seen.add(payment.externalId);
          payments.push(payment);
        }
      }
    }
    return payments;
  }
}
