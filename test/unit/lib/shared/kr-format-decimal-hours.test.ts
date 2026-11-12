/**
 * Decimaltimmar (#1542) — den gemensamma formatteraren som appens vyer visar
 * registrerad tid med. Lagrade minuter avrundas aldrig om.
 */
import { describe, it, expect } from "vitest-compat";
import { formatDecimalHours, formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";

const nb = (s: string): string => s.replace(/ /g, " ");

describe("formatDecimalHours", () => {
  it.each([
    [0, "0"],
    [6, "0,1"],
    [15, "0,25"],
    [30, "0,5"],
    [45, "0,75"],
    [90, "1,5"],
    [120, "2"],
  ])("%i min → %s", (minutes, expected) => {
    expect(formatDecimalHours(minutes)).toBe(expected);
  });

  it("äldre värde utanför 6-minutersintervallen visas med två decimaler", () => {
    expect(formatDecimalHours(37)).toBe("0,62");
  });

  it("stora värden utan decimaler", () => {
    expect(formatDecimalHours(6000)).toBe("100");
    expect(nb(formatDecimalHours(60_000))).toBe("1 000");
  });
});

describe("formatDecimalHoursWithUnit", () => {
  it("lägger till enheten h", () => {
    expect(formatDecimalHoursWithUnit(90)).toBe("1,5 h");
    expect(formatDecimalHoursWithUnit(0)).toBe("0 h");
  });
});
