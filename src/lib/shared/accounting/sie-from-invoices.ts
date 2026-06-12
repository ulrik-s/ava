/**
 * AVA-fakturor → SIE 4-fil (#244, ADR 0011-uppföljning).
 *
 * Orchestrerar den rena kedjan faktura → semantiskt verifikat ([[semantic-voucher]])
 * → SIE-rendering ([[sie]]). Ren, framework-agnostisk funktion — körs lika gärna
 * i browsern (demo + self-hosted) som på servern; ingen extern integration.
 *
 * Roll→konto använder byråns konto-mappning ([[account-map]]); faller tillbaka
 * på BAS-standard när ingen mappning är konfigurerad.
 */

import { DEFAULT_LEDGER_ACCOUNT_MAP, toSieAccountMap } from "./account-map";
import { buildSemanticVoucher, type SemanticVoucherInput } from "./semantic-voucher";
import { renderSie, type SieAccountMap, type SieCompany } from "./sie";
import type { VatRate } from "../vat";

/** BAS-standardkonton för en advokatbyrå (default tills byrån mappar själv). */
export const DEFAULT_BAS_ACCOUNT_MAP: SieAccountMap = toSieAccountMap(DEFAULT_LEDGER_ACCOUNT_MAP);

/** Bara utfärdade fakturor bokförs (samma som Fortnox-connectorn); ej DRAFT/CANCELLED/BAD_DEBT. */
export const SIE_EXPORTABLE_STATUSES: readonly string[] = ["SENT", "PAID", "INSTALLMENT_PLAN"];

/** Minsta faktura-fält exporten behöver. */
export interface ExportableInvoice extends SemanticVoucherInput {
  status: string;
}

export interface SieExportOptions {
  company: SieCompany;
  /** Genereringsdatum `YYYYMMDD` (för `#GEN`). */
  generatedDate: string;
  accountMap?: SieAccountMap;
  /** Verifikatserie (default "A"). */
  series?: string;
  vatRate?: VatRate;
}

/** Hur många av fakturorna som är exporterbara (för UI-gating). */
export function countExportable(invoices: readonly { status: string }[]): number {
  return invoices.filter((i) => SIE_EXPORTABLE_STATUSES.includes(i.status)).length;
}

/** Verifikatnummer ur fakturanumrets siffror (unikt), annars löpande index. */
function verNumber(inv: ExportableInvoice, index: number): string {
  const digits = inv.invoiceNumber?.replace(/\D/g, "");
  return digits ? digits : String(index + 1);
}

/** Rendera utfärdade fakturor till en SIE 4-fil. */
export function invoicesToSie(
  invoices: readonly ExportableInvoice[],
  opts: SieExportOptions,
): string {
  const exportable = invoices.filter((i) => SIE_EXPORTABLE_STATUSES.includes(i.status));
  const series = opts.series ?? "A";
  return renderSie({
    company: opts.company,
    generatedDate: opts.generatedDate,
    accountMap: opts.accountMap ?? DEFAULT_BAS_ACCOUNT_MAP,
    vouchers: exportable.map((inv, i) => ({
      meta: { series, number: verNumber(inv, i) },
      voucher: buildSemanticVoucher(inv, opts.vatRate),
    })),
  });
}
