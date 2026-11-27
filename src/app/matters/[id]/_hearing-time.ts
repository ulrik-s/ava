/**
 * Förhandlingens tider i kostnadsräkningsdialogen: fältens standardvärde och
 * det räkningen faktiskt yrkar när ärendet saknar förhandling. Utbrutet ur
 * _kostnadsrakning-modal.tsx (filstorleksspärren, #2195).
 */

/** En tidpunkt i datumfältets format `YYYY-MM-DDTHH:MM` (lokal tid, som `<input type="datetime-local">`). */
export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Förhandlingens start i datumfältet (`YYYY-MM-DDTHH:MM`): den sparade, annars i dag kl. 09:00. */
export function defaultStart(stored?: string | Date | null): string {
  if (stored) return toDatetimeLocalValue(new Date(stored));
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

/**
 * Det räkningen faktiskt yrkar. Utan förhandling (ärendet lades ner, ingen
 * "Deltagit i förhandling"-post) finns ingen förhandlingstid och ingen
 * brottmålstaxa: räkningen är bara ärendets poster (timkostnadsnorm × tid).
 */
export function effectiveHearing(hearing: boolean, hufStart: string, hufEnd: string, isTaxe: boolean): { hufEnd: string; isTaxe: boolean } {
  return hearing ? { hufEnd, isTaxe } : { hufEnd: hufStart, isTaxe: false };
}
