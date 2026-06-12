/**
 * `FortnoxLedgerConnector` — Fortnox bakom `LedgerConnector`-porten (#82, ADR 0011).
 *
 * Fortnox är EN av flera möjliga ledger-connectorer. Den tar emot domänens
 * systemoberoende semantiska verifikat ([[semantic-voucher]]) och renderar det
 * till Fortnox Voucher-JSON (roll→kontonummer via byråns konto-mappning) +
 * POST:ar mot Voucher API. Capabilities: bara `pushVoucher` — Fortnox-
 * connectorn skapar inga fakturor och hämtar inga betalningar här (jfr ADR
 * 0011: `pullPayments` löses vendor-neutralt via bankfil, #237).
 *
 * Idempotensen ägs av sync-drivern (invoice-job): kandidaten är "saknar
 * fortnoxId", och varje lyckad push märks direkt. Connectorn är därför ren
 * push utan eget idempotens-state.
 */

import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";
import type {
  LedgerCapabilities,
  LedgerConnector,
  PushVoucherResult,
} from "../ledger/port";
import type { FortnoxClient } from "./client";
import type { FortnoxKontoMappning } from "./schema";
import { renderFortnoxVoucher } from "./voucher";

export interface FortnoxConnectorDeps {
  client: Pick<FortnoxClient, "createVoucher">;
  /** Byråns roll→konto-mappning (#217), läst ur firma.git. */
  mapping: FortnoxKontoMappning;
}

const FORTNOX_CAPABILITIES: LedgerCapabilities = {
  pushVoucher: true,
  pushInvoice: false,
  pullPayments: false,
  exportSie: false,
};

export class FortnoxLedgerConnector implements LedgerConnector {
  readonly name = "fortnox";

  constructor(private readonly deps: FortnoxConnectorDeps) {}

  capabilities(): LedgerCapabilities {
    return FORTNOX_CAPABILITIES;
  }

  async pushVoucher(voucher: SemanticVoucher): Promise<PushVoucherResult> {
    const fortnoxVoucher = renderFortnoxVoucher(voucher, this.deps.mapping);
    const resp = await this.deps.client.createVoucher(fortnoxVoucher);
    return { externalId: `${resp.Voucher.VoucherSeries}/${resp.Voucher.VoucherNumber}` };
  }
}
