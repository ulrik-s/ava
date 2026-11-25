/**
 * Kalenderperioder (#2108): dag, ISO-vecka, månad och år, perioderna i ett
 * intervall och steg för en dag. EN indelning för rapporterna och
 * stapeldiagrammen, så att ingen bygger en egen veckoräkning.
 *
 * Dagar är strängar "YYYY-MM-DD", alltså svenska kalenderdagar (#1677).
 * Räkningen är ren kalenderräkning (UTC-kalendervärden och
 * `Temporal.PlainDate`) och beror varken på processens tidszon eller på
 * sommartid.
 */

import { Temporal } from "@js-temporal/polyfill";
import { addDays } from "./stockholm-time";

/** Storleken på en kalenderperiod. */
export type CalendarUnit = "day" | "week" | "month" | "year";

/** De storlekar en dag kan stega med (ett år stegas inte). */
export type DayStepUnit = Exclude<CalendarUnit, "year">;

/** En period av kalenderdagar, båda dagarna med ("YYYY-MM-DD"). */
export interface CalendarPeriod {
  from: string;
  to: string;
}

/** ISO-veckans år och nummer (veckan hör till året där dess torsdag ligger). */
export interface IsoWeek {
  year: number;
  week: number;
}

/** En hel ISO-vecka med måndag (`start`) och söndag (`end`) som UTC-midnatt. */
export interface IsoWeekSpan {
  isoYear: number;
  week: number;
  start: Date;
  end: Date;
}

const DAY_MS = 86_400_000;

/** Kalenderdagen "YYYY-MM-DD" som UTC-midnatt: ett rent kalendervärde för veckomatematiken. */
export function calendarDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Samma UTC-kalenderdag som `d`, vid UTC-midnatt. */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** UTC-kalenderdagen för `d` som "YYYY-MM-DD" (inverterar `calendarDate`). */
function dayOf(d: Date): string {
  return Temporal.PlainDate.from({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }).toString();
}

/** ISO-veckans år och nummer för UTC-kalenderdagen `d`. */
export function isoWeek(d: Date): IsoWeek {
  const dt = utcMidnight(d);
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((dt.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return { year: dt.getUTCFullYear(), week };
}

/** ISO-veckans år och nummer för kalenderdagen `day` ("Vecka 48 2026"). */
export function isoWeekOfDay(day: string): IsoWeek {
  return isoWeek(calendarDate(day));
}

/** Måndagen i ISO-veckan som UTC-kalenderdagen `d` ligger i, vid UTC-midnatt. */
export function mondayOfIsoWeek(d: Date): Date {
  const dt = utcMidnight(d);
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr);
  return dt;
}

/** Varje hel ISO-vecka som skär `from`–`to` (inte klippta), i tidsordning. */
export function weeksInRange(from: Date, to: Date): IsoWeekSpan[] {
  const weeks: IsoWeekSpan[] = [];
  let cursor = mondayOfIsoWeek(from);
  const end = utcMidnight(to);
  while (cursor.getTime() <= end.getTime()) {
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(cursor.getUTCDate() + 6);
    const { year, week } = isoWeek(cursor);
    weeks.push({ isoYear: year, week, start: new Date(cursor), end: weekEnd });
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

/** ISO-veckan måndag–söndag som `day` ligger i. */
function weekContaining(day: string): CalendarPeriod {
  const monday = dayOf(mondayOfIsoWeek(calendarDate(day)));
  return { from: monday, to: addDays(monday, 6) };
}

/** Månadens första till sista dag för `day`. */
function monthContaining(day: string): CalendarPeriod {
  const date = Temporal.PlainDate.from(day);
  return { from: date.with({ day: 1 }).toString(), to: date.with({ day: date.daysInMonth }).toString() };
}

/** 1 januari till 31 december för `day`:s år. */
function yearContaining(day: string): CalendarPeriod {
  const year = day.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const CONTAINING: Readonly<Record<CalendarUnit, (day: string) => CalendarPeriod>> = {
  day: (day) => ({ from: day, to: day }),
  week: weekContaining,
  month: monthContaining,
  year: yearContaining,
};

/**
 * Perioden av storleken `unit` som `day` ligger i: dagen själv, ISO-veckan
 * måndag–söndag, månadens första till sista dag, eller 1 januari–31 december.
 */
export function periodContaining(day: string, unit: CalendarUnit): CalendarPeriod {
  return CONTAINING[unit](day);
}

/**
 * Varje period av storleken `unit` som skär `from`–`to`, i tidsordning och
 * klippt till `from`–`to` (den första och den sista kan vara kortare).
 * `from` efter `to` ger en tom lista.
 */
export function periodsInRange(from: string, to: string, unit: CalendarUnit): CalendarPeriod[] {
  const periods: CalendarPeriod[] = [];
  let cursor = from;
  while (cursor <= to) {
    const period = periodContaining(cursor, unit);
    const end = period.to < to ? period.to : to;
    periods.push({ from: cursor, to: end });
    cursor = addDays(end, 1);
  }
  return periods;
}

const STEP: Readonly<Record<DayStepUnit, (day: string, n: number) => string>> = {
  day: (day, n) => addDays(day, n),
  week: (day, n) => addDays(day, 7 * n),
  // Temporal klipper en dag som inte finns till månadens sista: 01-31 + 1 månad = 02-28.
  month: (day, n) => Temporal.PlainDate.from(day).add({ months: n }).toString(),
};

/**
 * Dagen `n` dagar, veckor (7 dagar) eller månader efter `day` (negativt `n`
 * bakåt). En dag som inte finns i målmånaden blir månadens sista:
 * 2026-01-31 + 1 månad = 2026-02-28.
 */
export function stepDay(day: string, unit: DayStepUnit, n: number): string {
  return STEP[unit](day, n);
}
