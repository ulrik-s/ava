/**
 * `SieLedgerConnector` — SIE 4-fil-export bakom ledger-porten (#236, ADR 0011).
 *
 * En `LedgerConnector` som BARA har `exportSie`-capability:n: den kräver inget
 * externt bokföringssystem utan renderar domänens semantiska verifikat
 * ([[semantic-voucher]]) till en SIE 4-fil ([[sie]]) som byrån importerar i
 * valfritt system. För byråer utan Fortnox/extern ledger.
 *
 * Connectorn sluter över sin datakälla (`loadVouchers`) på samma sätt som
 * `FortnoxLedgerConnector` sluter över sin Fortnox-klient — runtime:n
 * injicerar källan (verifikat ur firma.git för intervallet). Tidsstämpeln för
 * `#GEN` kommer från en injicerad klocka (deterministisk i test).
 */

import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";
import { renderSie, type SieAccountMap, type SieCompany, type SieVoucherMeta } from "@/lib/shared/accounting/sie";
import type {
  LedgerCapabilities,
  LedgerConnector,
  SieExportRange,
} from "./port";

/** Ett verifikat med sin SIE-identitet, hämtat för export. */
export interface ExportableVoucher {
  meta: SieVoucherMeta;
  voucher: SemanticVoucher;
}

export interface SieConnectorDeps {
  company: SieCompany;
  accountMap: SieAccountMap;
  /** Hämta verifikaten för intervallet (injiceras av runtime; läser firma.git). */
  loadVouchers: (range: SieExportRange) => Promise<ReadonlyArray<ExportableVoucher>>;
  /** Klocka för `#GEN`-datumet (default = systemtid). */
  clock?: () => Date;
}

const SIE_CAPABILITIES: LedgerCapabilities = {
  pushVoucher: false,
  pushInvoice: false,
  pullPayments: false,
  exportSie: true,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function sieDate(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

export class SieLedgerConnector implements LedgerConnector {
  readonly name = "sie";

  constructor(private readonly deps: SieConnectorDeps) {}

  capabilities(): LedgerCapabilities {
    return SIE_CAPABILITIES;
  }

  async exportSie(range: SieExportRange): Promise<string> {
    const vouchers = await this.deps.loadVouchers(range);
    const clock = this.deps.clock ?? (() => new Date());
    return renderSie({
      company: this.deps.company,
      generatedDate: sieDate(clock()),
      accountMap: this.deps.accountMap,
      vouchers,
    });
  }
}
