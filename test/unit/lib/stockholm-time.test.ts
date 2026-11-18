/**
 * Byråns tidszon (#1167, #1350): kalenderdag och år i Europe/Stockholm,
 * oavsett serverns tidszon (UTC i docker).
 */
import { describe, expect, it } from "vitest-compat";
import { STOCKHOLM_TZ, stockholmDay, stockholmTime, stockholmYear } from "@/lib/shared/stockholm-time";

describe("stockholmDay", () => {
  it("svensk kalenderdag, inte UTC", () => {
    expect(stockholmDay(new Date("2026-09-24T22:00:00Z"))).toBe("2026-09-25"); // svensk midnatt
    expect(stockholmDay(new Date("2026-09-24T21:59:00Z"))).toBe("2026-09-24");
  });

  it("nyårsnatten (#1677): 23.30 UTC = 00.30 den 1 januari", () => {
    expect(stockholmDay(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
  });

  it("ett rent datum (UTC-midnatt) behåller sin dag, vinter som sommar", () => {
    expect(stockholmDay(new Date("2026-01-15"))).toBe("2026-01-15");
    expect(stockholmDay(new Date("2026-07-15"))).toBe("2026-07-15");
  });
});

describe("stockholmTime", () => {
  it("klockslaget i svensk tid, 24-timmars", () => {
    expect(stockholmTime(new Date("2025-12-31T23:30:00Z"))).toBe("00:30"); // vintertid, UTC+1
    expect(stockholmTime(new Date("2026-07-01T13:05:00Z"))).toBe("15:05"); // sommartid, UTC+2
  });
});

describe("STOCKHOLM_TZ", () => {
  it("är byråns IANA-zon", () => {
    expect(STOCKHOLM_TZ).toBe("Europe/Stockholm");
  });
});

describe("stockholmYear", () => {
  it("nyårsnatten 00.30 svensk tid (23.30 UTC) hör till det NYA året", () => {
    expect(stockholmYear(new Date("2026-12-31T23:30:00Z"))).toBe(2027);
  });

  it("strax före svensk midnatt är det fortfarande det gamla året", () => {
    expect(stockholmYear(new Date("2026-12-31T22:59:00Z"))).toBe(2026);
  });

  it("sommartid: årsskiftet påverkas inte, mitt på året samma år", () => {
    expect(stockholmYear(new Date("2026-07-01T12:00:00Z"))).toBe(2026);
  });
});
