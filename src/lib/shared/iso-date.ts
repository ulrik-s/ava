/**
 * Datum och klockslag i BYRÅNS tidszon (Europe/Stockholm, #1677).
 *
 * Fanns i tre privata kopior (kostnadsräkningen, Fortnox-renderaren,
 * bokföringsfönstret). De räknade i processens lokala tid — men servern kör i
 * UTC, så ett Fortnox-verifikat daterat 2026-01-01 kl. 00:30 svensk tid fick
 * datumet 31 december (förra räkenskapsåret) medan fakturanumret
 * (`stockholmYear`) hamnade på det nya året. Nu räknar allt i Stockholm,
 * oavsett var koden kör (#1677).
 */

import { addDays, STOCKHOLM_TZ, stockholmDay, stockholmTime } from "./stockholm-time";

const LONG_DATE_FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: STOCKHOLM_TZ, day: "numeric", month: "long", year: "numeric" });
const WEEKDAY_DATE_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: STOCKHOLM_TZ, weekday: "long", day: "numeric", month: "long", year: "numeric",
});

function asDate(d: Date | string): Date {
  return typeof d === "string" ? new Date(d) : d;
}

/**
 * `YYYY-MM-DD` (Stockholm) ur ett `Date` eller en datumsträng. Ett rent datum
 * ("2026-01-15" = UTC-midnatt = 01:00 svensk tid) behåller sin dag.
 */
export function toIsoDate(d: Date | string): string {
  return stockholmDay(asDate(d));
}

/** `HH:MM` (Stockholm) — klockslaget i en förhandling eller ett förhör. */
export function toLocalTime(d: Date | string): string {
  return stockholmTime(asDate(d));
}

/** `"24 september 2026"` (Stockholm) — datum i ord, som i ett brev (#1218). */
export function toSwedishLongDate(d: Date | string): string {
  return LONG_DATE_FMT.format(asDate(d));
}

/**
 * Dagens namn för kalenderdagen `day` ("YYYY-MM-DD"): "Idag", "Igår" eller
 * "Imorgon" räknat från dagen i Stockholm vid `now` (#1677), annars veckodag
 * och datum i ord ("torsdag 26 november 2026"). Ren: tiden kommer in som `now`.
 */
export function dayLabel(day: string, now: Date): string {
  const today = stockholmDay(now);
  if (day === today) return "Idag";
  if (day === addDays(today, -1)) return "Igår";
  if (day === addDays(today, 1)) return "Imorgon";
  return WEEKDAY_DATE_FMT.format(asDate(day));
}
