/**
 * Texterna i rutan Stapeldiagram (#2110): vyerna, periodens namn och
 * staplarnas tillgängliga namn. Rena funktioner över kalenderdagar
 * ("YYYY-MM-DD"), så att de inte beror på processens tidszon.
 */

import { z } from "zod";
import {
  calendarDate, isoWeekOfDay, type CalendarUnit, type DayStepUnit,
} from "@/lib/shared/calendar-periods";
import { dayLabel } from "@/lib/shared/iso-date";
import { formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import type { TimeChartBar, TimeChartGranularity } from "@/lib/shared/time-chart";

/** Vyn rutan visar: perioden diagrammet täcker. */
export type TimeChartView = CalendarUnit;

/** Knapparna Dag / Vecka / Månad / År. */
export const TIME_CHART_VIEW_OPTIONS: ReadonlyArray<{ value: TimeChartView; label: string }> = [
  { value: "day", label: "Dag" },
  { value: "week", label: "Vecka" },
  { value: "month", label: "Månad" },
  { value: "year", label: "År" },
];

/** Staplarnas storlek per vy: nivån under perioden (Dag visar dagen som en stapel). */
export const TIME_CHART_GRANULARITY: Readonly<Record<TimeChartView, TimeChartGranularity>> = {
  day: "day",
  week: "day",
  month: "week",
  year: "month",
};

/**
 * Pilarnas steg per vy (#2111): Dag och Vecka stegar en dag, Månad en vecka
 * och År en månad, alltså en stapel i taget (Dag: en dag).
 */
export const TIME_CHART_STEP: Readonly<Record<TimeChartView, DayStepUnit>> = {
  day: "day",
  week: "day",
  month: "week",
  year: "month",
};

/** Nyckeln för personens förvalda vy (`prefs`), samma för rutan överallt. */
export const TIME_CHART_PREF_KEY = "chart.time";

/** Den vy rutan öppnar i när inget giltigt är sparat. */
export const TIME_CHART_DEFAULT_VIEW: TimeChartView = "week";

const timeChartPrefSchema = z.object({ view: z.enum(["day", "week", "month", "year"]) });

/** Den sparade vyn ur `prefs`; saknas den eller är den ogiltig: {@link TIME_CHART_DEFAULT_VIEW}. */
export function parseTimeChartView(prefs: unknown): TimeChartView {
  const r = timeChartPrefSchema.safeParse(prefs);
  return r.success ? r.data.view : TIME_CHART_DEFAULT_VIEW;
}

// `calendarDate` ger UTC-midnatt, så formaterarna läser i UTC: dagen ändras inte.
const MONTH_YEAR_FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", month: "long", year: "numeric" });
const WEEKDAY_DAY_MONTH_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function weekName(day: string): string {
  const { week, year } = isoWeekOfDay(day);
  return `Vecka ${week} ${year}`;
}

const PERIOD_TITLE: Readonly<Record<TimeChartView, (day: string, now: Date) => string>> = {
  day: (day, now) => dayLabel(day, now),
  week: (day) => weekName(day),
  month: (day) => MONTH_YEAR_FMT.format(calendarDate(day)),
  year: (day) => day.slice(0, 4),
};

/**
 * Periodens namn för vyn som innehåller `day`: "måndag 24 november 2026"
 * (eller "Idag"), "Vecka 48 2026", "november 2026" eller "2026".
 */
export function timeChartPeriodTitle(view: TimeChartView, day: string, now: Date): string {
  return PERIOD_TITLE[view](day, now);
}

const BAR_NAME: Readonly<Record<TimeChartGranularity, (from: string) => string>> = {
  day: (from) => capitalize(WEEKDAY_DAY_MONTH_FMT.format(calendarDate(from))),
  week: (from) => `Vecka ${isoWeekOfDay(from).week}`,
  month: (from) => capitalize(MONTH_YEAR_FMT.format(calendarDate(from))),
};

/** Stapelns tillgängliga namn: "Måndag 24 november: 6,5 h", "Vecka 48: 12 h", "November 2026: 40 h". */
export function timeChartBarAriaLabel(bar: TimeChartBar, granularity: TimeChartGranularity): string {
  return `${BAR_NAME[granularity](bar.from)}: ${formatDecimalHoursWithUnit(bar.totalMinutes)}`;
}

/** Stapelns period: dagen ensam, annars "från – till". */
export function timeChartBarPeriod(bar: Pick<TimeChartBar, "from" | "to">): string {
  return bar.from === bar.to ? bar.from : `${bar.from} – ${bar.to}`;
}
