/**
 * Byråns tidszon (Europe/Stockholm) för kalenderdagar och år. Servern kör i
 * UTC (docker): räknat i UTC hamnar svensk midnatt på föregående dag (#1167),
 * och 00–01 svensk tid på nyårsnatten i FÖRRA året (#1350).
 */

const DAY_FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Kalenderdagen i byråns tidszon, "YYYY-MM-DD" (#1167). Räknat i UTC blev en
 * frist på svensk midnatt (25/9 00:00 = 24/9 22:00 UTC) gårdagens datum.
 */
export function stockholmDay(d: Date): string {
  return DAY_FMT.format(d);
}

/**
 * Året i byråns tidszon (#1350) — nummerserierna (fakturor, ärenden,
 * kostnadsräkningar) och de årsberoende normerna räknas på det svenska året.
 */
export function stockholmYear(d: Date): number {
  return Number(stockholmDay(d).slice(0, 4));
}
