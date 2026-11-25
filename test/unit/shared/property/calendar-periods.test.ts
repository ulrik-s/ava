/**
 * Egenskapstester (fast-check) för kalenderperioderna (#2108): svaren är
 * desamma i alla processens tidszoner som i UTC (servern kör i UTC,
 * utvecklarna i Stockholm), och ett dagssteg fram och tillbaka ger samma dag.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import { isoWeekOfDay, periodContaining, periodsInRange, stepDay } from "@/lib/shared/calendar-periods";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** En kalenderdag "YYYY-MM-DD" 1900–2199. */
const plainDate: fc.Arbitrary<string> = fc
  .date({ min: new Date("1900-01-01T00:00:00Z"), max: new Date("2199-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);

/** Zoner långt från Stockholm åt båda hållen, halv- och kvartstimmar, egen sommartid. */
const PROCESS_ZONES = [
  "UTC", "Europe/Stockholm", "America/Los_Angeles", "America/St_Johns", "Asia/Tokyo",
  "Asia/Kathmandu", "Australia/Lord_Howe", "Pacific/Kiritimati", "Pacific/Pago_Pago",
] as const;

/** Kör `fn` med processens tidszon satt till `tz` (se stockholm-time-testet om Bun och TZ). */
function inProcessZone<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = original ?? "Etc/UTC";
  }
}

/** Allt modulen svarar för en dag och ett kort intervall från den. */
const answers = (day: string): unknown[] => [
  periodContaining(day, "day"), periodContaining(day, "week"), periodContaining(day, "month"), periodContaining(day, "year"),
  periodsInRange(day, stepDay(day, "day", 40), "week"), periodsInRange(day, stepDay(day, "month", 3), "month"),
  stepDay(day, "day", -1), stepDay(day, "week", 1), stepDay(day, "month", -1), isoWeekOfDay(day),
];

describe("oberoende av processens tidszon (#1677)", () => {
  it("samma svar i alla tidszoner som i UTC", () => {
    fc.assert(fc.property(plainDate, fc.constantFrom(...PROCESS_ZONES), (day, tz) => {
      expect(inProcessZone(tz, () => answers(day))).toEqual(inProcessZone("UTC", () => answers(day)));
    }));
  });
});

describe("stepDay", () => {
  it("n dagar fram och n dagar tillbaka ger samma dag", () => {
    fc.assert(fc.property(plainDate, fc.integer({ min: -1000, max: 1000 }), (day, n) => {
      expect(stepDay(stepDay(day, "day", n), "day", -n)).toBe(day);
    }));
  });
});

describe("periodContaining", () => {
  it("dagen ligger i sin period, och veckan är måndag–söndag", () => {
    fc.assert(fc.property(plainDate, (day) => {
      const week = periodContaining(day, "week");
      expect(week.from <= day && day <= week.to).toBe(true);
      expect(stepDay(week.from, "day", 6)).toBe(week.to);
      expect(new Date(`${week.from}T00:00:00Z`).getUTCDay()).toBe(1);
    }));
  });
});
