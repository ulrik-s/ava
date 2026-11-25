/**
 * Byråns tidszon (#1167, #1350): kalenderdag och år i Europe/Stockholm,
 * oavsett serverns tidszon (UTC i docker).
 */
import { describe, expect, it } from "vitest-compat";
import {
  STOCKHOLM_TZ, stockholmDateTime, stockholmDay, stockholmDayStart, stockholmPeriod, stockholmTime, stockholmYear,
} from "@/lib/shared/stockholm-time";

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

describe("stockholmDayStart (#1797)", () => {
  it("vintertid: svensk midnatt är 23:00Z dagen före", () => {
    expect(stockholmDayStart("2026-01-15").toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("sommartid: svensk midnatt är 22:00Z dagen före", () => {
    expect(stockholmDayStart("2026-07-15").toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("dagen för omställningen till sommartid börjar i vintertid", () => {
    expect(stockholmDayStart("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("dagen för omställningen till vintertid börjar i sommartid", () => {
    expect(stockholmDayStart("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("ogiltig dag kastar", () => {
    expect(() => stockholmDayStart("2026-02-30x")).toThrow();
    expect(() => stockholmDayStart("inte-en-dag")).toThrow();
  });
});

describe("stockholmPeriod (#1797)", () => {
  it("slutar en millisekund före nästa dags början", () => {
    const p = stockholmPeriod("2026-01-01", "2026-01-31");
    expect(p.from.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-01-31T22:59:59.999Z");
  });

  it("en enda dag", () => {
    const p = stockholmPeriod("2026-07-15", "2026-07-15");
    expect(p.from.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-07-15T21:59:59.999Z");
  });

  it("över omställningen till sommartid", () => {
    const p = stockholmPeriod("2026-03-01", "2026-03-31");
    expect(p.from.toISOString()).toBe("2026-02-28T23:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-03-31T21:59:59.999Z");
  });

  it("över omställningen till vintertid", () => {
    const p = stockholmPeriod("2026-10-01", "2026-10-31");
    expect(p.from.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-31T22:59:59.999Z");
  });

  it("ett ögonblick 00:30 svensk tid hör till den svenska dagen, inte UTC-dygnet", () => {
    const p = stockholmPeriod("2026-01-15", "2026-01-15");
    const halfPastMidnight = new Date("2026-01-14T23:30:00Z");
    expect(halfPastMidnight >= p.from && halfPastMidnight <= p.to).toBe(true);
  });

  it("ogiltig dag kastar", () => {
    expect(() => stockholmPeriod("2026-01-01", "nej")).toThrow();
    expect(() => stockholmPeriod("nej", "2026-01-01")).toThrow();
  });
});

describe("stockholmDateTime (#1855)", () => {
  it("klockslaget på den svenska dagen, vintertid och sommartid", () => {
    expect(stockholmDateTime("2026-03-02", "09:30").toISOString()).toBe("2026-03-02T08:30:00.000Z");
    expect(stockholmDateTime("2026-07-01", "09:30").toISOString()).toBe("2026-07-01T07:30:00.000Z");
  });

  it("tillbaka till samma dag och klockslag", () => {
    const d = stockholmDateTime("2026-12-31", "23:45");
    expect([stockholmDay(d), stockholmTime(d)]).toEqual(["2026-12-31", "23:45"]);
  });
});
