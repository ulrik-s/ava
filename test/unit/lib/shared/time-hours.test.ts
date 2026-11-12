/**
 * Tillåtna tidsvärden (#1544): regel, tolkning av inmatad text och avrundning.
 */
import { describe, it, expect } from "vitest-compat";
import {
  ALLOWED_MINUTES_PAST_HOUR, isAllowedMinutes, parseHoursToMinutes, roundToAllowedMinutes,
  TIME_NOT_A_NUMBER_MESSAGE, TIME_NOT_ALLOWED_MESSAGE,
} from "@/lib/shared/time-hours";

describe("isAllowedMinutes", () => {
  it("alla tolv decimaler är tillåtna, även efter hela timmar", () => {
    expect(ALLOWED_MINUTES_PAST_HOUR).toEqual([0, 6, 12, 15, 18, 24, 30, 36, 42, 45, 48, 54]);
    for (const m of ALLOWED_MINUTES_PAST_HOUR) {
      expect(isAllowedMinutes(m)).toBe(true);
      expect(isAllowedMinutes(120 + m)).toBe(true);
    }
  });

  it("0 är tillåtet (per-dygnskategorier)", () => {
    expect(isAllowedMinutes(0)).toBe(true);
  });

  it("andra värden, bråkdelar och negativa tal är otillåtna", () => {
    for (const m of [1, 5, 20, 37, 61, 79, 6.5, -6]) expect(isAllowedMinutes(m)).toBe(false);
  });
});

describe("parseHoursToMinutes", () => {
  const ok = (minutes: number) => ({ ok: true, minutes });
  const notAllowed = { ok: false, error: TIME_NOT_ALLOWED_MESSAGE };
  const notANumber = { ok: false, error: TIME_NOT_A_NUMBER_MESSAGE };

  it("komma och punkt som decimaltecken, mellanslag ignoreras", () => {
    expect(parseHoursToMinutes("1,5")).toEqual(ok(90));
    expect(parseHoursToMinutes("1.5")).toEqual(ok(90));
    expect(parseHoursToMinutes(" 2 ")).toEqual(ok(120));
    expect(parseHoursToMinutes("0,25")).toEqual(ok(15));
    expect(parseHoursToMinutes("1,1")).toEqual(ok(66));
    expect(parseHoursToMinutes("1 0,75")).toEqual(ok(645));
  });

  it("otillåtna värden ger fel, ingen tyst avrundning", () => {
    expect(parseHoursToMinutes("1,33")).toEqual(notAllowed);
    expect(parseHoursToMinutes("0,05")).toEqual(notAllowed);
    expect(parseHoursToMinutes("0,125")).toEqual(notAllowed);
  });

  it("ogiltig text, tom text och negativa tal ger fel", () => {
    for (const raw of ["abc", "", "   ", "-1", "-0,5", "1,2,3", "1e2"]) expect(parseHoursToMinutes(raw)).toEqual(notANumber);
  });
});

describe("roundToAllowedMinutes", () => {
  it("närmaste tillåtna värde, lika avstånd uppåt", () => {
    expect(roundToAllowedMinutes(3)).toBe(6);
    expect(roundToAllowedMinutes(9)).toBe(12);
    expect(roundToAllowedMinutes(37)).toBe(36);
    expect(roundToAllowedMinutes(57)).toBe(60);
    expect(roundToAllowedMinutes(130)).toBe(132);
  });

  it("0 blir 0 och tid över 0 blir minst 6", () => {
    expect(roundToAllowedMinutes(0)).toBe(0);
    expect(roundToAllowedMinutes(1)).toBe(6);
    expect(roundToAllowedMinutes(-5)).toBe(0);
  });

  it("tillåtna värden lämnas orörda", () => {
    for (const m of ALLOWED_MINUTES_PAST_HOUR) expect(roundToAllowedMinutes(60 + m)).toBe(60 + m);
  });
});
