/**
 * Kalenderperioderna (#2108): dag, ISO-vecka, månad och år, perioderna i ett
 * intervall och steg för en dag — i svensk kalenderdag ("YYYY-MM-DD").
 */

import { describe, expect, it } from "vitest-compat";
import {
  calendarDate,
  isoWeek,
  isoWeekOfDay,
  mondayOfIsoWeek,
  periodContaining,
  periodsInRange,
  stepDay,
  weeksInRange,
  type CalendarPeriod,
  type CalendarUnit,
} from "@/lib/shared/calendar-periods";

describe("periodContaining", () => {
  it("dag: dagen själv", () => {
    expect(periodContaining("2026-11-25", "day")).toEqual({ from: "2026-11-25", to: "2026-11-25" });
  });

  it("vecka: måndag–söndag, en söndag hör till veckan som började måndagen innan", () => {
    expect(periodContaining("2026-11-25", "week")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
    expect(periodContaining("2026-11-29", "week")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
    expect(periodContaining("2026-11-23", "week")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  });

  it("vecka: vecka 53 2026 sträcker sig över årsskiftet", () => {
    expect(periodContaining("2026-12-31", "week")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(periodContaining("2027-01-03", "week")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("månad: första till sista dagen, också skottdagen", () => {
    expect(periodContaining("2026-11-25", "month")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodContaining("2028-02-29", "month")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodContaining("2026-02-10", "month")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodContaining("2026-12-31", "month")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("år: 1 januari till 31 december", () => {
    expect(periodContaining("2026-12-31", "year")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodContaining("2027-01-01", "year")).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(periodContaining("2028-02-29", "year")).toEqual({ from: "2028-01-01", to: "2028-12-31" });
  });
});

/** Perioderna täcker `from`–`to` utan glapp och utan överlapp. */
function expectContiguous(periods: CalendarPeriod[], from: string, to: string): void {
  expect(periods[0]?.from).toBe(from);
  expect(periods.at(-1)?.to).toBe(to);
  for (let i = 1; i < periods.length; i++) {
    expect(periods[i]?.from).toBe(stepDay(periods[i - 1]?.to ?? "", "day", 1));
  }
}

describe("periodsInRange", () => {
  it("veckor klipps i båda ändar, och en vecka över ett månadsskifte är hel", () => {
    expect(periodsInRange("2026-11-25", "2026-12-09", "week")).toEqual([
      { from: "2026-11-25", to: "2026-11-29" },
      { from: "2026-11-30", to: "2026-12-06" },
      { from: "2026-12-07", to: "2026-12-09" },
    ]);
  });

  it("ISO-vecka 53 över årsskiftet är en period", () => {
    expect(periodsInRange("2026-12-21", "2027-01-10", "week")).toEqual([
      { from: "2026-12-21", to: "2026-12-27" },
      { from: "2026-12-28", to: "2027-01-03" },
      { from: "2027-01-04", to: "2027-01-10" },
    ]);
  });

  it("månader och år klipps till intervallet", () => {
    expect(periodsInRange("2026-01-15", "2026-03-10", "month")).toEqual([
      { from: "2026-01-15", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-10" },
    ]);
    expect(periodsInRange("2026-06-01", "2027-02-01", "year")).toEqual([
      { from: "2026-06-01", to: "2026-12-31" },
      { from: "2027-01-01", to: "2027-02-01" },
    ]);
  });

  it("dagar: en period per dag över månadsskiftet", () => {
    expect(periodsInRange("2026-02-27", "2026-03-01", "day")).toEqual([
      { from: "2026-02-27", to: "2026-02-27" },
      { from: "2026-02-28", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-01" },
    ]);
  });

  it("ett intervall på en dag ger en period för varje storlek", () => {
    for (const unit of ["day", "week", "month", "year"] as const) {
      expect(periodsInRange("2026-11-25", "2026-11-25", unit)).toEqual([{ from: "2026-11-25", to: "2026-11-25" }]);
    }
  });

  it("from efter to ger en tom lista", () => {
    expect(periodsInRange("2026-11-26", "2026-11-25", "week")).toEqual([]);
  });

  it("perioderna täcker intervallet utan glapp eller överlapp", () => {
    const units: CalendarUnit[] = ["day", "week", "month", "year"];
    for (const unit of units) {
      expectContiguous(periodsInRange("2025-12-17", "2028-03-02", unit), "2025-12-17", "2028-03-02");
    }
  });
});

describe("stepDay", () => {
  it("dag åt båda hållen över månads- och årsskiften", () => {
    expect(stepDay("2026-12-31", "day", 1)).toBe("2027-01-01");
    expect(stepDay("2027-01-01", "day", -1)).toBe("2026-12-31");
    expect(stepDay("2026-02-28", "day", 1)).toBe("2026-03-01");
    expect(stepDay("2028-03-01", "day", -1)).toBe("2028-02-29");
  });

  it("vecka är sju dagar åt båda hållen", () => {
    expect(stepDay("2026-12-28", "week", 1)).toBe("2027-01-04");
    expect(stepDay("2027-01-04", "week", -1)).toBe("2026-12-28");
    expect(stepDay("2026-11-25", "week", -2)).toBe("2026-11-11");
  });

  it("månad: en dag som inte finns blir månadens sista", () => {
    expect(stepDay("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(stepDay("2028-01-31", "month", 1)).toBe("2028-02-29");
    expect(stepDay("2026-03-31", "month", -1)).toBe("2026-02-28");
    expect(stepDay("2026-11-25", "month", 2)).toBe("2027-01-25");
  });
});

describe("ISO-veckan", () => {
  it("isoWeekOfDay ger veckans nummer och år kring årsskiftet", () => {
    expect(isoWeekOfDay("2026-12-31")).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOfDay("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOfDay("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeekOfDay("2026-11-25")).toEqual({ year: 2026, week: 48 });
  });

  it("isoWeek och mondayOfIsoWeek läser UTC-kalenderdagen", () => {
    expect(isoWeek(calendarDate("2025-12-29"))).toEqual({ year: 2026, week: 1 });
    expect(mondayOfIsoWeek(calendarDate("2026-11-29"))).toEqual(calendarDate("2026-11-23"));
  });

  it("weeksInRange ger hela veckor, inte klippta", () => {
    expect(weeksInRange(calendarDate("2026-12-30"), calendarDate("2027-01-05"))).toEqual([
      { isoYear: 2026, week: 53, start: calendarDate("2026-12-28"), end: calendarDate("2027-01-03") },
      { isoYear: 2027, week: 1, start: calendarDate("2027-01-04"), end: calendarDate("2027-01-10") },
    ]);
    expect(weeksInRange(calendarDate("2026-12-01"), calendarDate("2026-11-25"))).toEqual([]);
  });
});
