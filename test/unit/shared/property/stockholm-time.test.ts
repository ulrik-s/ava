/**
 * Egenskapstester (fast-check) för kalenderdagen i svensk tid
 * (`stockholm-time.ts`, `iso-date.ts`, #1167/#1350/#1677).
 *
 * En kalenderdag i AVA är ALLTID dagen i Europe/Stockholm — aldrig UTC-dygnet
 * och aldrig processens tidszon. Här jämförs hjälparna med två oberoende facit
 * för tusentals tidpunkter, tätt kring sommartidsomställningarna och nyårsnatten:
 *
 *   - `Intl.DateTimeFormat#formatToParts` i en annan locale (delarna, inte den
 *     svenska strängmallen),
 *   - ren aritmetik efter EU-regeln (sommartid från sista söndagen i mars till
 *     sista söndagen i oktober, 01.00 UTC) — utan Intl och utan tz-databas.
 *
 * Och resultatet får inte bero på processens tidszon (servern kör i UTC,
 * utvecklarna i Stockholm).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import { dayLabel, toIsoDate, toLocalTime, toSwedishLongDate } from "@/lib/shared/iso-date";
import { addDays, stockholmDay, stockholmTime, stockholmYear } from "@/lib/shared/stockholm-time";
import { nearStockholmNewYear } from "../../helpers/arbitraries";
import { inProcessZone, plainDateBetween, PROCESS_ZONES } from "../../helpers/process-zone";

const HOUR_MS = 3_600_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");

interface DayAndTime { day: string; time: string }

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Facit 1: Stockholmsdagen och -klockslaget ur `formatToParts` (en-US, delarna sätts ihop här). */
function intlStockholm(d: Date): DayAndTime {
  const parts = PARTS.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "?";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Sista söndagen i månaden (0-baserad) kl. 01.00 UTC — EU:s omställningsögonblick. */
function lastSundayOneUtc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay(), 1);
}

/** Facit 2: EU-regeln som ren aritmetik (gäller Sverige sedan 1996). */
function euStockholm(d: Date): DayAndTime {
  const ms = d.getTime();
  const year = d.getUTCFullYear();
  const summer = ms >= lastSundayOneUtc(year, 2) && ms < lastSundayOneUtc(year, 9);
  const local = new Date(ms + (summer ? 2 : 1) * HOUR_MS);
  return {
    day: `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`,
    time: `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`,
  };
}

/** En tidpunkt högst tre timmar från en sommartidsomställning, 1996–2037. */
const nearDstChange: fc.Arbitrary<Date> = fc
  .tuple(fc.integer({ min: 1996, max: 2037 }), fc.constantFrom(2, 9), fc.integer({ min: -3 * HOUR_MS, max: 3 * HOUR_MS }))
  .map(([year, month, offset]) => new Date(lastSundayOneUtc(year, month) + offset));

/** Kritiska tidpunkter (omställningar, nyår) blandat med vilka som helst 1996–2037. */
const euInstant: fc.Arbitrary<Date> = fc.oneof(
  nearDstChange,
  nearStockholmNewYear(1996, 2037),
  fc.date({ min: new Date("1996-01-01T00:00:00Z"), max: new Date("2037-12-31T23:59:59Z"), noInvalidDate: true }),
);

/** Vilken tidpunkt som helst 1900–2199 (historiska och framtida tidszonsregler). */
const anyInstant = fc.date({ min: new Date("1900-01-01T00:00:00Z"), max: new Date("2199-12-31T23:59:59Z"), noInvalidDate: true });

describe("stockholmDay / stockholmTime / stockholmYear", () => {
  it("är dagen och klockslaget enligt EU-regeln, också runt omställningarna och nyår", () => {
    fc.assert(fc.property(euInstant, (d) => {
      expect({ day: stockholmDay(d), time: stockholmTime(d) }).toEqual(euStockholm(d));
    }));
  });

  it("är dagen och klockslaget enligt tz-databasen (formatToParts), 1900–2199", () => {
    fc.assert(fc.property(fc.oneof(anyInstant, euInstant), (d) => {
      expect({ day: stockholmDay(d), time: stockholmTime(d) }).toEqual(intlStockholm(d));
    }));
  });

  it("året är den svenska dagens år — nyårsnatten hör till det nya året", () => {
    fc.assert(fc.property(fc.oneof(nearStockholmNewYear(1996, 2037), anyInstant), (d) => {
      expect(stockholmYear(d)).toBe(Number(intlStockholm(d).day.slice(0, 4)));
    }));
  });
});

/**
 * Ett rent datum "YYYY-MM-DD" (UTC-midnatt). Fyrsiffriga år: under år 1000 ger
 * den svenska mallen inga inledande nollor ("999-03-01") — inget datum AVA
 * hanterar.
 */
const plainDate = plainDateBetween(1000, 9999);

describe("toIsoDate / toLocalTime", () => {
  it("ett rent datum behåller sin dag", () => {
    fc.assert(fc.property(plainDate, (s) => {
      expect(toIsoDate(s)).toBe(s);
    }));
  });

  it("samma tidpunkt som Date och som ISO-sträng ger samma dag och klockslag", () => {
    fc.assert(fc.property(fc.oneof(anyInstant, euInstant), (d) => {
      expect(toIsoDate(d)).toBe(stockholmDay(d));
      expect(toIsoDate(d.toISOString())).toBe(stockholmDay(d));
      expect(toLocalTime(d.toISOString())).toBe(stockholmTime(d));
    }));
  });
});

// ─── Oberoende av processens tidszon ──────────────────────────────────────

/** Allt hjälparna svarar för en tidpunkt och ett rent datum. */
const answers = (d: Date, plain: string): string[] =>
  [stockholmDay(d), stockholmTime(d), String(stockholmYear(d)), toIsoDate(plain), toLocalTime(d.toISOString()), toSwedishLongDate(d),
    addDays(plain, -1), addDays(plain, 1), dayLabel(plain, d)];

describe("oberoende av processens tidszon (#1677)", () => {
  it("att byta TZ i processen slår faktiskt igenom (annars prövar egenskapen inget)", () => {
    expect(inProcessZone("Asia/Tokyo", () => new Date(0).getTimezoneOffset())).toBe(-540);
    expect(inProcessZone("America/Los_Angeles", () => new Date(0).getTimezoneOffset())).toBe(480);
  });

  it("samma svar i alla tidszoner som i UTC", () => {
    fc.assert(fc.property(fc.oneof(euInstant, anyInstant), plainDate, fc.constantFrom(...PROCESS_ZONES), (d, plain, tz) => {
      expect(inProcessZone(tz, () => answers(d, plain))).toEqual(inProcessZone("UTC", () => answers(d, plain)));
    }));
  });
});

describe("addDays (#2095)", () => {
  it("n dagar fram och n dagar tillbaka ger samma dag", () => {
    fc.assert(fc.property(plainDate, fc.integer({ min: -1000, max: 1000 }), (plain, n) => {
      expect(addDays(addDays(plain, n), -n)).toBe(plain);
    }));
  });
});
