/** Texterna i rutan Stapeldiagram (#2110). */
import { describe, it, expect } from "vitest-compat";
import {
  parseTimeChartView, TIME_CHART_GRANULARITY, TIME_CHART_STEP, timeChartBarAriaLabel, timeChartBarPeriod, timeChartPeriodTitle,
} from "@/components/time/time-chart-labels";

const NOW = new Date("2026-11-26T12:00:00Z");
const bar = (from: string, to: string, totalMinutes: number) => ({
  key: from, label: "", from, to, totalMinutes, billableMinutes: 0, matters: [],
});

describe("time-chart-labels", () => {
  it("staplarna är nivån under perioden", () => {
    expect(TIME_CHART_GRANULARITY).toEqual({ day: "day", week: "day", month: "week", year: "month" });
  });

  it("pilarna stegar en stapel: Dag och Vecka en dag, Månad en vecka, År en månad (#2111)", () => {
    expect(TIME_CHART_STEP).toEqual({ day: "day", week: "day", month: "week", year: "month" });
  });

  it("den sparade vyn tolkas, och saknad eller ogiltig ger Vecka (#2111)", () => {
    expect(parseTimeChartView({ view: "month" })).toBe("month");
    expect(parseTimeChartView({ view: "year" })).toBe("year");
    expect(parseTimeChartView(null)).toBe("week");
    expect(parseTimeChartView(undefined)).toBe("week");
    expect(parseTimeChartView({ view: "decade" })).toBe("week");
    expect(parseTimeChartView("month")).toBe("week");
  });

  it("periodens namn per vy", () => {
    expect(timeChartPeriodTitle("day", "2026-11-24", NOW)).toBe("tisdag 24 november 2026");
    expect(timeChartPeriodTitle("day", "2026-11-26", NOW)).toBe("Idag");
    expect(timeChartPeriodTitle("week", "2026-11-24", NOW)).toBe("Vecka 48 2026");
    expect(timeChartPeriodTitle("week", "2027-01-01", NOW)).toBe("Vecka 53 2026");
    expect(timeChartPeriodTitle("month", "2026-11-24", NOW)).toBe("november 2026");
    expect(timeChartPeriodTitle("year", "2026-11-24", NOW)).toBe("2026");
  });

  it("stapelns tillgängliga namn per storlek", () => {
    expect(timeChartBarAriaLabel(bar("2026-11-23", "2026-11-23", 390), "day")).toBe("Måndag 23 november: 6,5 h");
    expect(timeChartBarAriaLabel(bar("2026-11-23", "2026-11-29", 720), "week")).toBe("Vecka 48: 12 h");
    expect(timeChartBarAriaLabel(bar("2026-11-01", "2026-11-30", 0), "month")).toBe("November 2026: 0 h");
  });

  it("stapelns period: dagen ensam, annars från – till", () => {
    expect(timeChartBarPeriod({ from: "2026-11-24", to: "2026-11-24" })).toBe("2026-11-24");
    expect(timeChartBarPeriod({ from: "2026-11-23", to: "2026-11-29" })).toBe("2026-11-23 – 2026-11-29");
  });
});
