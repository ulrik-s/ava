/**
 * Förhandlingens tider i kostnadsräkningsdialogen (#2195): fältets standardvärde.
 */
import { describe, expect, it } from "vitest-compat";
import { defaultStart, toDatetimeLocalValue } from "@/app/matters/[id]/_hearing-time";

describe("toDatetimeLocalValue", () => {
  it("nollfyller månad, dag, timme och minut", () => {
    expect(toDatetimeLocalValue(new Date(2027, 0, 4, 7, 3))).toBe("2027-01-04T07:03");
  });
});

describe("defaultStart", () => {
  it("visar den sparade starten i datumfältets format", () => {
    const stored = new Date(2026, 10, 3, 13, 5);
    expect(defaultStart(stored)).toBe("2026-11-03T13:05");
    expect(defaultStart(stored.toISOString())).toBe("2026-11-03T13:05");
  });

  it("utan sparad start: i dag kl. 09:00", () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(defaultStart(null)).toBe(`${today}T09:00`);
    expect(defaultStart()).toBe(`${today}T09:00`);
  });
});
