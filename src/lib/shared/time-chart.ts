/**
 * Stapeldiagram över registrerad tid (#2109): en persons tidsposter indelade
 * per dag, ISO-vecka eller månad i ett intervall, med summor och ärendena per
 * stapel. Ren och ramverksfri; `timeEntry.chart` läser posterna och lämnar
 * indelningen hit.
 *
 * Indelningen är `periodsInRange` (#2108), och varje post räknas på sin
 * svenska kalenderdag (`stockholmDay`, #1677).
 */

import { Temporal } from "@js-temporal/polyfill";
import { isoWeekOfDay, periodsInRange, type CalendarPeriod } from "./calendar-periods";
import { stockholmDay } from "./stockholm-time";

/** Stapelns storlek. */
export type TimeChartGranularity = "day" | "week" | "month";

/** Ärendet en post hör till, som det visas vid en stapel. */
export interface TimeChartMatter {
  id: string;
  matterNumber: string;
  title: string;
}

/** Det diagrammet läser ur en tidspost. */
export interface TimeChartEntry {
  date: Date | string;
  minutes: number;
  billable: boolean;
  matter: TimeChartMatter | null | undefined;
}

/** En stapel: en period (klippt till intervallet), dess summor och ärenden. */
export interface TimeChartBar {
  /** Periodens första dag ("YYYY-MM-DD"). */
  key: string;
  /** Kort svensk etikett: "mån 24/11", "v. 48" eller "nov". */
  label: string;
  from: string;
  to: string;
  totalMinutes: number;
  billableMinutes: number;
  /** Ärendena med tid i stapeln, unika och sorterade på ärendenummer. */
  matters: TimeChartMatter[];
}

/** Hela diagrammet: totalerna och staplarna i tidsordning. */
export interface TimeChart {
  totalMinutes: number;
  billableMinutes: number;
  bars: TimeChartBar[];
}

/** Indata till {@link buildTimeChart}. */
export interface TimeChartInput {
  entries: readonly TimeChartEntry[];
  /** Intervallets första dag ("YYYY-MM-DD"). */
  from: string;
  /** Intervallets sista dag ("YYYY-MM-DD"), med. */
  to: string;
  granularity: TimeChartGranularity;
}

const WEEKDAYS = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"] as const;
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"] as const;

const LABEL: Readonly<Record<TimeChartGranularity, (day: string) => string>> = {
  day: (day) => {
    const date = Temporal.PlainDate.from(day);
    return `${WEEKDAYS[date.dayOfWeek - 1] ?? ""} ${date.day}/${date.month}`;
  },
  week: (day) => `v. ${isoWeekOfDay(day).week}`,
  month: (day) => MONTHS[Temporal.PlainDate.from(day).month - 1] ?? "",
};

/** Stapelns kortetikett för perioden som börjar på `day`. */
export function timeChartLabel(day: string, granularity: TimeChartGranularity): string {
  return LABEL[granularity](day);
}

/** En stapel under uppbyggnad: ärendena samlas per id. */
interface BarAcc {
  period: CalendarPeriod;
  totalMinutes: number;
  billableMinutes: number;
  matters: Map<string, TimeChartMatter>;
}

/** Stapeln vars period innehåller `day`, eller undefined utanför intervallet. */
function barFor(bars: readonly BarAcc[], day: string): BarAcc | undefined {
  return bars.find((b) => b.period.from <= day && day <= b.period.to);
}

/** Lägg postens minuter och ärende i stapeln. */
function addEntry(bar: BarAcc, entry: TimeChartEntry): void {
  bar.totalMinutes += entry.minutes;
  if (entry.billable) bar.billableMinutes += entry.minutes;
  if (entry.matter) bar.matters.set(entry.matter.id, entry.matter);
}

/** Den färdiga stapeln, med ärendena sorterade på ärendenummer. */
function finishBar(bar: BarAcc, granularity: TimeChartGranularity): TimeChartBar {
  const { from, to } = bar.period;
  const matters = [...bar.matters.values()].sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv"));
  return {
    key: from, label: timeChartLabel(from, granularity), from, to,
    totalMinutes: bar.totalMinutes, billableMinutes: bar.billableMinutes, matters,
  };
}

/**
 * Tidsposterna per dag, ISO-vecka eller månad i `from`–`to`. En stapel per
 * period som skär intervallet (klippt till det), också tomma, i tidsordning.
 * Staplarnas summor är tillsammans totalen; debiterbar tid är posterna med
 * `billable`. En post utan ärende räknas i summorna men ger ingen ärenderad.
 */
export function buildTimeChart({ entries, from, to, granularity }: TimeChartInput): TimeChart {
  const bars: BarAcc[] = periodsInRange(from, to, granularity)
    .map((period) => ({ period, totalMinutes: 0, billableMinutes: 0, matters: new Map() }));
  for (const entry of entries) {
    const bar = barFor(bars, stockholmDay(typeof entry.date === "string" ? new Date(entry.date) : entry.date));
    if (bar) addEntry(bar, entry);
  }
  const done = bars.map((b) => finishBar(b, granularity));
  return {
    totalMinutes: done.reduce((s, b) => s + b.totalMinutes, 0),
    billableMinutes: done.reduce((s, b) => s + b.billableMinutes, 0),
    bars: done,
  };
}
