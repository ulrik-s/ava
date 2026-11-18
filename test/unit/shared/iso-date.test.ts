/**
 * `toIsoDate` m.fl. — utbrutna ur tre privata kopior (#1035).
 *
 * Svensk tid, oavsett processens tidszon (#1677): servern kör i UTC, så ett
 * verifikat daterat 2026-01-01 kl. 00:30 svensk tid fick förut den 31
 * december och hamnade i fel räkenskapsår. Testerna använder därför absoluta
 * tidpunkter (`Z`/offset) — de ger samma svar i CI (UTC) som lokalt.
 */

import { describe, it, expect } from "vitest-compat";
import { toIsoDate, toLocalTime, toSwedishLongDate } from "@/lib/shared/iso-date";

describe("toIsoDate", () => {
  it("nollutfyller månad och dag", () => {
    expect(toIsoDate(new Date("2026-01-03T12:00:00Z"))).toBe("2026-01-03");
  });

  it("tar en datumsträng lika väl som ett Date — ett rent datum behåller sin dag", () => {
    expect(toIsoDate("2026-11-24")).toBe("2026-11-24");
    expect(toIsoDate("2026-01-15")).toBe("2026-01-15"); // UTC-midnatt = 01:00 svensk tid
  });

  it("nyårsnatten: 23:30 UTC = 00:30 svensk tid hör till det NYA året", () => {
    expect(toIsoDate(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    expect(toIsoDate("2025-12-31T23:30:00Z")).toBe("2026-01-01");
  });

  it("strax före svensk midnatt hör till den gamla dagen", () => {
    expect(toIsoDate(new Date("2025-12-31T22:59:00Z"))).toBe("2025-12-31");
  });

  it("sommartid (CEST, UTC+2): svensk midnatt är 22:00 UTC", () => {
    expect(toIsoDate(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(toIsoDate(new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
  });

  it("ogiltigt datum kastar, som toISOString()", () => {
    expect(() => toIsoDate("inte ett datum")).toThrow(RangeError);
  });
});

describe("toLocalTime", () => {
  it("klockslaget i svensk tid, vintertid och sommartid", () => {
    expect(toLocalTime(new Date("2025-12-31T23:30:00Z"))).toBe("00:30");
    expect(toLocalTime("2026-07-01T07:05:00Z")).toBe("09:05");
  });
});

describe("toSwedishLongDate", () => {
  it("datum i ord på den svenska dagen", () => {
    expect(toSwedishLongDate(new Date("2025-12-31T23:30:00Z"))).toBe("1 januari 2026");
    expect(toSwedishLongDate("2026-09-24")).toBe("24 september 2026");
  });
});
