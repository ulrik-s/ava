/**
 * Hjälpare för periodfilter i tidsregistrering.
 *
 * Datum-inputs ger lokala YYYY-MM-DD-strängar. Tabellen visar `date` via
 * toLocaleDateString (lokal dag), så filtret bracketar den lokala dagen:
 * `from` = lokal midnatt, `to` = lokal slut-på-dagen. Då hamnar en post som
 * lagrats som UTC-midnatt (visas som tidig morgon lokalt) korrekt inom intervallet.
 */

/** Lokal dagstart för en YYYY-MM-DD-sträng, eller undefined om tom. */
export function periodFrom(date: string): Date | undefined {
  return date ? new Date(`${date}T00:00:00.000`) : undefined;
}

/** Lokal slut-på-dagen för en YYYY-MM-DD-sträng, eller undefined om tom. */
export function periodTo(date: string): Date | undefined {
  return date ? new Date(`${date}T23:59:59.999`) : undefined;
}
