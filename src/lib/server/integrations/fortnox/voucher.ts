/**
 * Fortnox-renderare för det semantiska verifikatet (#82, #235, ADR 0011).
 *
 * Domänen bygger ett systemoberoende verifikat mot ROLLER
 * ([[semantic-voucher]]). Den här filen är Fortnox-connectorns renderare:
 * den översätter roll→kontonummer (via byråns konto-mappning) och öre→SEK,
 * och paketerar Fortnox Voucher-JSON. Inget moms-/balans-resonemang sker här
 * — det äger domänmodellen. Samma semantiska modell ger gratis SIE-export
 * och andra renderare (uppföljning på #233).
 */

import type {
  SemanticVoucher,
  SemanticVoucherRow,
  VoucherRole,
} from "@/lib/shared/accounting/semantic-voucher";
import { toIsoDate } from "@/lib/shared/iso-date";
import type { FortnoxKontoMappning, FortnoxVoucher, FortnoxVoucherRow } from "./schema";

/** Öre (heltal) → SEK med 2 decimaler. Exakt eftersom öre alltid är heltal. */
function oreToSek(ore: number): number {
  return ore / 100;
}

/** Roll → Fortnox-kontonummer via byråns mappning. Kastar om rollen är omappad. */
function accountForRole(role: VoucherRole, mapping: FortnoxKontoMappning): string {
  // Roll→konto-uppslag; de valfria rollerna (utlägg/reducerad moms) är undefined
  // om byrån inte mappat dem → completeness-gate kastar.
  const account: string | undefined = {
    kundfordran: mapping.kundfordran,
    intaktArvode: mapping.intaktArvode,
    momsUtgaende: mapping.momsUtgaende,
    momsUtgaende12: mapping.momsUtgaende12,
    momsUtgaende06: mapping.momsUtgaende06,
    intaktUtlagg: mapping.intaktUtlagg,
  }[role];
  if (!account) throw new Error(`Rollen '${role}' saknar kontomappning`);
  return account;
}

function renderRow(row: SemanticVoucherRow, mapping: FortnoxKontoMappning): FortnoxVoucherRow {
  return {
    Account: Number(accountForRole(row.role, mapping)),
    Debit: oreToSek(row.debit),
    Credit: oreToSek(row.credit),
  };
}

/** Rendera ett färdigt semantiskt verifikat till Fortnox Voucher-JSON. */
export function renderFortnoxVoucher(
  voucher: SemanticVoucher,
  mapping: FortnoxKontoMappning,
): FortnoxVoucher {
  return {
    VoucherSeries: mapping.voucherSeries,
    TransactionDate: toIsoDate(voucher.date),
    Description: voucher.description,
    VoucherRows: voucher.rows.map((r) => renderRow(r, mapping)),
  };
}
