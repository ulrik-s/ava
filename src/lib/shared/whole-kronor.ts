/**
 * Avrundning av fakturans och kostnadsräkningens rader (#1438) — EN plats.
 *
 * ## Regeln
 *
 * Varje rad (tidspost, kategorirad, utläggsrad, klientens/betalarens andel,
 * aconto) avrundas till HELA KRONOR. Summan exkl moms är summan av de avrundade
 * raderna; momsen är satsen på den summan, avrundad till hela kronor; brutto =
 * netto + moms. Därmed är ALLT på fakturan hela kronor: det lagrade beloppet,
 * dokumentet, OCR-beloppet, kundfordran och verifikatet (debet = kredit utan
 * öresdiff).
 *
 * Avrundningen är svensk öresavrundning (lag (1970:1029) om avrundning av
 * öresbelopp): 1–49 öre avrundas nedåt, 50–99 öre uppåt. Negativa belopp
 * speglas (−0,50 kr → −1 kr), så en kreditering avrundas som originalet.
 *
 * ## Äldre fakturor
 *
 * Fakturor skapade före #1438 är avrundade på öret (`ORE`). Deras belopp är
 * lagrade och räknas aldrig om — men specifikationen (tider/utlägg) härleds ur
 * posterna när dokumentet renderas, och då måste den räknas med fakturans EGET
 * avrundningssätt (`roundingOf`). Annars skulle ett omrenderat äldre dokument
 * visa andra rader än det som skickades.
 *
 * ## Belopp utifrån
 *
 * Belopp som någon annan fastställt — domstolens beviljade belopp, försäkrings-
 * bolagets prutning, redan betalda aconton — tas som de är. Avrundningen gäller
 * de rader AVA själv räknar fram.
 */

import type { AmountRounding } from "./schemas/enums";

/** Avrundningssättet för fakturor och kostnadsräkningar som skapas nu. */
export const CURRENT_ROUNDING: AmountRounding = "KRONOR";

/** Öre → närmaste hela krona (i öre), enligt öresavrundningen. */
export function roundToKronor(ore: number): number {
  return kronorQuotient(ore, 1);
}

/**
 * `ore / divisor` till närmaste hela krona (i öre) i EN division — t.ex.
 * minuter × timpris / 60 — så att ett belopp som är exakt X,50 kr inte först
 * avrundas på öret och sedan en gång till.
 */
export function kronorQuotient(ore: number, divisor: number): number {
  const kronor = Math.round(Math.abs(ore) / (100 * divisor)) * 100;
  // `0 - 0` är +0 — ett nollbelopp ska aldrig bli −0.
  return ore < 0 ? 0 - kronor : kronor;
}

/** En rad avrundad enligt fakturans avrundningssätt: hela kronor eller helt öre. */
export function roundRow(ore: number, rounding: AmountRounding = CURRENT_ROUNDING): number {
  return rounding === "KRONOR" ? roundToKronor(ore) : Math.round(ore);
}

/** `ore / divisor` avrundad som en rad: hela kronor, eller helt öre på äldre fakturor. */
function roundQuotient(ore: number, divisor: number, rounding: AmountRounding): number {
  return rounding === "KRONOR" ? kronorQuotient(ore, divisor) : Math.round(ore / divisor);
}

/** Momsen (öre) på ett netto vid satsen `bips` (2500 = 25 %), avrundad som raderna. */
export function vatOnRow(netOre: number, bips: number, rounding: AmountRounding = CURRENT_ROUNDING): number {
  return roundQuotient(netOre * bips, 10_000, rounding);
}

/** Andelen `bips` av ett belopp (klientens självrisk m.m.), avrundad som en rad. */
export function shareOfRow(ore: number, bips: number): number {
  return kronorQuotient(ore * bips, 10_000);
}

/** Tid × timpris som en rad i hela kronor: minuter × öre/tim / 60, avrundat i
 *  en division (äldre fakturors rader räknas med `timeEntryValueOre`). */
export function timeRowOre(minutes: number, hourlyRateOre: number): number {
  return kronorQuotient(minutes * hourlyRateOre, 60);
}

/**
 * Dela ett bruttobelopp (inkl moms) i netto och moms. Nettot avrundas som en
 * rad och momsen är resten, så netto + moms alltid är exakt bruttot.
 */
export function splitGross(grossOre: number, bips: number, rounding: AmountRounding = CURRENT_ROUNDING): { netOre: number; vatOre: number } {
  // Momsfritt: hela bruttot är netto, även när det har ören (t.ex. ett belopp utifrån).
  if (bips === 0) return { netOre: grossOre, vatOre: 0 };
  const netOre = roundQuotient(grossOre * 10_000, 10_000 + bips, rounding);
  return { netOre, vatOre: grossOre - netOre };
}

/** Fakturans avrundningssätt — en faktura utan fältet är en äldre (`ORE`). */
export function roundingOf(invoice: { amountRounding?: AmountRounding | null | undefined }): AmountRounding {
  return invoice.amountRounding ?? "ORE";
}
