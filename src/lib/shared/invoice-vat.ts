/**
 * Fakturans moms i öre — EN tolkning för alla läsare (#1806).
 *
 * En faktura bär sin moms på upp till tre sätt, beroende på ålder:
 *   1. `vatBreakdown` — momsuppdelning per sats (#790). Finns den gäller
 *      summan av radernas `vatOre`.
 *   2. `vatOre` — exakt momsbelopp (#782), för fakturor utan uppdelning.
 *   3. Inget av dem (äldre rader, och krediter av sådana) → en split av
 *      beloppet med `fallbackRate` (25 %), med beloppets tecken.
 *
 * Verifikatet och fakturadokumentet läste förr reserven olika (25 %-split
 * respektive 0), så samma faktura fick en moms i bokföringen och en annan på
 * dokumentet till klienten. Nästa läsare (SIE, rapporter …) använder den här
 * modulen i stället för en egen `?? 0`.
 *
 * Indatat är strukturellt så att verifikatets indata, fakturadokumentets
 * faktura och domänens `Invoice` kan skickas in utan omvandling. Modulen
 * importerar bara `./vat`: verifikatet importerar den, och en typimport åt
 * andra hållet vore ett cirkelberoende.
 */

import { DEFAULT_VAT_RATE, splitVat } from "./vat";

/** En rad i en momsuppdelning — det enda fält modulen läser. */
export interface InvoiceVatLine {
  /** Moms i öre (negativ på en kredit). */
  vatOre: number;
}

/** Fakturans momsfält, strukturellt (verifikat, dokument och domän passar). */
export interface InvoiceVatInput {
  /** Brutto i öre (negativt = kreditfaktura). */
  amount: number;
  /** Exakt momsbelopp i öre (#782). Saknas på äldre fakturor. */
  vatOre?: number | null | undefined;
  /** Momsuppdelning per sats (#790). Tom eller saknad = ingen uppdelning. */
  vatBreakdown?: readonly InvoiceVatLine[] | null | undefined;
}

/**
 * Sann när fakturan har en momsuppdelning med minst en rad. En tom lista
 * räknas som saknad. Typvakt: efter vägvalet är `vatBreakdown` aldrig null.
 */
export function hasVatBreakdown<T extends InvoiceVatInput>(
  invoice: T,
): invoice is T & { vatBreakdown: NonNullable<T["vatBreakdown"]> } {
  return invoice.vatBreakdown != null && invoice.vatBreakdown.length > 0;
}

/**
 * Fakturans moms i öre, med tecken: uppdelningens summa när den finns, annars
 * `vatOre`, annars en split av `|amount|` med `fallbackRate` och beloppets
 * tecken. Ingen klippning — det är läsarens sak (verifikatet klipper äldre,
 * inkonsekvent data så att det balanserar).
 */
export function invoiceVatOre(invoice: InvoiceVatInput, fallbackRate: number = DEFAULT_VAT_RATE): number {
  if (hasVatBreakdown(invoice)) return invoice.vatBreakdown.reduce((s, l) => s + l.vatOre, 0);
  if (invoice.vatOre != null) return invoice.vatOre;
  const vat = splitVat({ amount: Math.abs(invoice.amount), vatRate: fallbackRate, vatIncluded: true }).vat;
  return invoice.amount < 0 ? -vat : vat;
}
