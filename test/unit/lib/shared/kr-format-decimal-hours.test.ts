/**
 * Tid i decimaltimmar (#1542): minuter → svenskt decimalkomma, högst två
 * decimaler och inga onödiga. Bara visningen avrundas, aldrig datan.
 */

import { describe, it, expect } from "vitest-compat";
import { formatDecimalHours, formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";

describe("formatDecimalHours", () => {
  it("tillåtna värden utan onödiga decimaler", () => {
    expect(formatDecimalHours(0)).toBe("0");
    expect(formatDecimalHours(6)).toBe("0,1");
    expect(formatDecimalHours(15)).toBe("0,25");
    expect(formatDecimalHours(30)).toBe("0,5");
    expect(formatDecimalHours(45)).toBe("0,75");
    expect(formatDecimalHours(90)).toBe("1,5");
    expect(formatDecimalHours(120)).toBe("2");
  });

  it("äldre tid utanför rutnätet visas med två decimaler", () => {
    expect(formatDecimalHours(37)).toBe("0,62");
    expect(formatDecimalHours(1)).toBe("0,02");
  });

  it("stora värden", () => {
    expect(formatDecimalHours(6000)).toBe("100");
    expect(formatDecimalHours(90_000).replace(/\s/g, " ")).toBe("1 500");
  });
});

describe("formatDecimalHoursWithUnit", () => {
  it("lägger till enheten h", () => {
    expect(formatDecimalHoursWithUnit(90)).toBe("1,5 h");
    expect(formatDecimalHoursWithUnit(0)).toBe("0 h");
  });
});
