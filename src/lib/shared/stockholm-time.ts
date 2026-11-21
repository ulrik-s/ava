/**
 * Byråns tidszon (Europe/Stockholm) för kalenderdagar, klockslag och år. Servern
 * kör i UTC (docker): räknat i UTC hamnar svensk midnatt på föregående dag
 * (#1167), och 00–01 svensk tid på nyårsnatten i FÖRRA året (#1350).
 *
 * EN regel (#1677): en kalenderdag i AVA är ALLTID dagen i Stockholm — aldrig
 * processens tidszon och aldrig `toISOString().slice(0, 10)` (UTC-dygnet).
 * ESLint spärrar det senare i `src/`.
 */

import { Temporal } from "@js-temporal/polyfill";

/** Byråns tidszon, för `Intl`-format som inte finns som hjälpare här. */
export const STOCKHOLM_TZ = "Europe/Stockholm";

const DAY_FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: STOCKHOLM_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const TIME_FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: STOCKHOLM_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Kalenderdagen i byråns tidszon, "YYYY-MM-DD" (#1167). Räknat i UTC blev en
 * frist på svensk midnatt (25/9 00:00 = 24/9 22:00 UTC) gårdagens datum.
 * Ett rent datum ("2026-01-15" → UTC-midnatt = 01:00 svensk tid) behåller sin dag.
 * Ogiltigt datum kastar `RangeError`, precis som `toISOString()`.
 */
export function stockholmDay(d: Date): string {
  return DAY_FMT.format(d);
}

/** Klockslaget i byråns tidszon, "HH:MM" (24-timmars) (#1677). */
export function stockholmTime(d: Date): string {
  return TIME_FMT.format(d);
}

/**
 * Året i byråns tidszon (#1350) — nummerserierna (fakturor, ärenden,
 * kostnadsräkningar) och de årsberoende normerna räknas på det svenska året.
 */
export function stockholmYear(d: Date): number {
  return Number(stockholmDay(d).slice(0, 4));
}

/**
 * Ögonblicket då den svenska kalenderdagen `day` ("YYYY-MM-DD") börjar, 00:00
 * i Stockholm. Använd den på servern när ett ögonblick ska jämföras mot en
 * svensk kalenderdag: aldrig UTC-dygnet (`setUTCHours`). Ogiltig dag kastar,
 * som `Temporal.PlainDate.from`.
 */
export function stockholmDayStart(day: string): Date {
  const start = Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: STOCKHOLM_TZ });
  return new Date(start.epochMilliseconds);
}

/**
 * Gränserna för den svenska kalenderperioden `from`–`to` (båda "YYYY-MM-DD",
 * båda dagarna med): från början av `from` till sista millisekunden före
 * början av dagen efter `to`. Använd den på servern när ett ögonblick ska
 * jämföras mot en svensk period (rapporter, månader, veckor), även över en
 * omställning till eller från sommartid.
 */
export function stockholmPeriod(from: string, to: string): { from: Date; to: Date } {
  const dayAfter = Temporal.PlainDate.from(to).add({ days: 1 }).toString();
  return { from: stockholmDayStart(from), to: new Date(stockholmDayStart(dayAfter).getTime() - 1) };
}
