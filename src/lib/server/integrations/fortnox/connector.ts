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
 * ledgerRef", och varje lyckad push märks direkt. Connectorn är därför ren
 * push utan eget idempotens-state.
 */

import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";
import type {
  LedgerAttachment,
  LedgerCapabilities,
  LedgerConnector,
  LedgerPushContext,
  PushVoucherResult,
} from "../ledger/port";
import type { FortnoxClient } from "./client";
import type { FortnoxKontoMappning } from "./schema";
import { renderFortnoxVoucher } from "./voucher";

export interface FortnoxConnectorDeps {
  client: Pick<FortnoxClient, "createVoucher" | "uploadInboxFile" | "connectFileToVoucher">;
  /** Byråns roll→konto-mappning (#217), läst ur firma.git. */
  mapping: FortnoxKontoMappning;
}

const FORTNOX_CAPABILITIES: LedgerCapabilities = {
  pushVoucher: true,
  pushInvoice: false,
  pullPayments: false,
  exportSie: false,
};

/** Skälet när Fortnox svar på verifikatet saknar räkenskapsåret. */
export const MISSING_YEAR = "Fortnox svar saknar räkenskapsår (Year) – bilagan laddades inte upp.";

export class FortnoxLedgerConnector implements LedgerConnector {
  readonly name = "fortnox";

  constructor(private readonly deps: FortnoxConnectorDeps) {}

  capabilities(): LedgerCapabilities {
    return FORTNOX_CAPABILITIES;
  }

  async pushVoucher(voucher: SemanticVoucher, ctx?: LedgerPushContext): Promise<PushVoucherResult> {
    const fortnoxVoucher = renderFortnoxVoucher(voucher, this.deps.mapping);
    const resp = await this.deps.client.createVoucher(fortnoxVoucher);
    const series = resp.Voucher.VoucherSeries;
    const number = String(resp.Voucher.VoucherNumber);
    const externalId = `${series}/${number}`;
    if (!ctx?.attachment) return { externalId };
    const attachmentError = await this.attachOrExplain(ctx.attachment, series, number, resp.Voucher.Year);
    return attachmentError ? { externalId, attachmentError } : { externalId };
  }

  /**
   * Bifoga faktura-PDF:en till konteringen (#785) — lagkrav att originalet
   * arkiveras. Verifikatet finns redan, så ett fel här kastas inte (#1885): det
   * blir skälet som returneras, annars null. Utan räkenskapsår (`Year`) i svaret
   * laddas ingenting upp (#1886): serie + nummer räcker inte för att hitta rätt
   * verifikat, och fel verifikat är värre än inget.
   */
  private async attachOrExplain(
    attachment: LedgerAttachment,
    series: string,
    number: string,
    year: number | undefined,
  ): Promise<string | null> {
    if (year === undefined) return MISSING_YEAR;
    try {
      const fileId = await this.deps.client.uploadInboxFile(attachment.fileName, attachment.bytes, attachment.contentType);
      await this.deps.client.connectFileToVoucher(fileId, series, number, year);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
}
