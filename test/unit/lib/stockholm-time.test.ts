/**
 * Byråns tidszon (#1167, #1350): kalenderdag och år i Europe/Stockholm,
 * oavsett serverns tidszon (UTC i docker).
 */
import { describe, expect, it } from "vitest-compat";
import { stockholmDay, stockholmYear } from "@/lib/shared/stockholm-time";

describe("stockholmDay", () => {
  it("svensk kalenderdag, inte UTC", () => {
    expect(stockholmDay(new Date("2026-09-24T22:00:00Z"))).toBe("2026-09-25"); // svensk midnatt
    expect(stockholmDay(new Date("2026-09-24T21:59:00Z"))).toBe("2026-09-24");
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
