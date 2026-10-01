/**
 * Löpnummerserier (#1350): numerisk jämförelse, minst fyra siffror, växer
 * förbi 9999 i stället för att krocka.
 */
import { describe, expect, it } from "vitest-compat";
import { formatSeriesNumber, nextSeriesNumber, seriesPattern, seriesSeq } from "@/lib/server/number-series";

describe("number-series", () => {
  it("formaterar med minst fyra siffror och växer därefter", () => {
    expect(formatSeriesNumber("F-2026-", 7)).toBe("F-2026-0007");
    expect(formatSeriesNumber("F-2026-", 12345)).toBe("F-2026-12345");
  });

  it("löpnumret ur ett nummer i serien; annat ger 0", () => {
    expect(seriesSeq("F-2026-", "F-2026-0042")).toBe(42);
    expect(seriesSeq("F-2026-", "F-2026-10000")).toBe(10000);
    expect(seriesSeq("F-2026-", "F-2025-0042")).toBe(0);
    expect(seriesSeq("F-2026-", "F-2026-0042-K")).toBe(0);
    expect(seriesSeq("F-2026-", null)).toBe(0);
    expect(seriesSeq("F-2026-", undefined)).toBe(0);
  });

  it("nästa nummer efter det NUMERISKT högsta — 10000 slår 9999", () => {
    expect(nextSeriesNumber("F-2026-", ["F-2026-9999", "F-2026-10000", null])).toBe("F-2026-10001");
    expect(nextSeriesNumber("KR-2026-", [])).toBe("KR-2026-0001");
  });

  it("mönstret matchar exakt prefix + siffror och escapar regex-tecken i prefixet", () => {
    const re = new RegExp(seriesPattern("F-2026-"));
    expect(re.test("F-2026-10000")).toBe(true);
    expect(re.test("F-2026-0001-K")).toBe(false);
    expect(re.test("XF-2026-0001")).toBe(false);
    expect(seriesPattern("A.B-")).toBe("^A\\.B-[0-9]+$");
  });
});
