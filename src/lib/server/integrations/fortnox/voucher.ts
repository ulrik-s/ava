/**
 * Bygg ett Fortnox-verifikat (voucher) från en AVA-kundfaktura (#82).
 *
 * Standard kundfaktura (brutto, inkl moms) → balanserat verifikat:
 *   Debet  kundfordran      = brutto
 *   Kredit intäkt (arvode)  = netto (exkl moms)
 *   Kredit utgående moms     = moms
 *
 * Kreditfaktura (negativt belopp) vänder debet/kredit. Balans GARANTERAS
 * genom att moms räknas som brutto − netto (ingen avrundnings-glipa).
 *
 * Belopp i AVA är öre (heltal); Fortnox vill ha kronor (SEK med 2 decimaler).
 * Endast en VAT-sats i taget (default 25 %); flersats-/utläggs-uppdelning
 * läggs till när vi kopplar in fakturarader (uppföljning).
 */

import { splitVat, type VatRate } from "@/lib/shared/vat";
import type { FortnoxKontoMappning, FortnoxVoucher, FortnoxVoucherRow } from "./schema";

/** Minsta fält connectorn behöver — frikopplat från hela Invoice-schemat. */
export interface InvoiceForVoucher {
  /** Brutto i öre (negativt = kreditfaktura). */
  amount: number;
  invoiceDate: Date | string;
  invoiceNumber?: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` (lokal tid) — Fortnox TransactionDate-format. */
function isoDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Öre (heltal) → SEK med 2 decimaler. Exakt eftersom öre alltid är heltal. */
function oreToSek(ore: number): number {
  return ore / 100;
}

function row(account: string, sekAmount: number, debit: boolean): FortnoxVoucherRow {
  return {
    Account: Number(account),
    Debit: debit ? sekAmount : 0,
    Credit: debit ? 0 : sekAmount,
  };
}

export function buildVoucherFromInvoice(
  invoice: InvoiceForVoucher,
  mapping: FortnoxKontoMappning,
  vatRate: VatRate = 2500,
): FortnoxVoucher {
  const bruttoOre = Math.abs(invoice.amount);
  const { exclVat } = splitVat({ amount: bruttoOre, vatRate, vatIncluded: true });
  const momsOre = bruttoOre - exclVat; // balans-säker rest
  const kundfordranIsDebit = invoice.amount >= 0; // kreditfaktura vänder

  const rows = [
    row(mapping.kundfordran, oreToSek(bruttoOre), kundfordranIsDebit),
    row(mapping.intaktArvode, oreToSek(exclVat), !kundfordranIsDebit),
    row(mapping.momsUtgaende, oreToSek(momsOre), !kundfordranIsDebit),
  ].filter((r) => r.Debit > 0 || r.Credit > 0); // släng 0-rader (t.ex. moms vid 0 %)

  return {
    VoucherSeries: mapping.voucherSeries,
    TransactionDate: isoDate(invoice.invoiceDate),
    Description: invoice.invoiceNumber ? `Faktura ${invoice.invoiceNumber}` : "Kundfaktura (AVA)",
    VoucherRows: rows,
  };
}
