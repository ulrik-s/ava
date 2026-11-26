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

/**
 * Är en period vald (#2096)? Sann när **Från** eller **Till** (eller båda) är
 * ifyllt. Då visar listan perioden; annars en dag i taget med pilar.
 */
export function hasPeriod(from: string, to: string): boolean {
  return from !== "" || to !== "";
}

/** Gränserna som tidslistans fråga får (`from`/`to` till `timeEntry.list`). */
export interface ListRange {
  from: Date | undefined;
  to: Date | undefined;
}

/**
 * Listans gränser (#2096): perioden går före dagen. Utan period gäller dagen
 * `day` ("YYYY-MM-DD"), med samma dygnsgränser som perioden Från = Till = dag;
 * med period gäller perioden exakt som förut (en tom gräns är öppen).
 */
export function listRange(day: string, from: string, to: string): ListRange {
  if (!hasPeriod(from, to)) return { from: periodFrom(day), to: periodTo(day) };
  return { from: periodFrom(from), to: periodTo(to) };
}
