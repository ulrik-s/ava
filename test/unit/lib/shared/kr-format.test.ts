/**
 * `formatKr` — appens enda formaterare för belopp i kronor (#1946) — och
 * á-priset `formatRateKr`. Båda skriver hårt mellanslag (U+00A0) före "kr".
 */
import { describe, expect, it } from "vitest-compat";
import { formatKr, formatRateKr } from "@/lib/shared/kr-format";

const NBSP = " ";

describe("formatKr", () => {
  it("öre → kronor med två decimaler, U+00A0 som tusentalsavgränsare och före kr", () => {
    expect(formatKr(123_456_789)).toBe(`1${NBSP}234${NBSP}567,89${NBSP}kr`);
    expect(formatKr(5_097_510)).toBe(`50${NBSP}975,10${NBSP}kr`);
    expect(formatKr(0)).toBe(`0,00${NBSP}kr`);
    expect(formatKr(5)).toBe(`0,05${NBSP}kr`);
  });

  it("negativa belopp (kreditfaktura) med svenskt minustecken U+2212", () => {
    expect(formatKr(-500_000)).toBe(`−5${NBSP}000,00${NBSP}kr`);
  });

  it("ger samma text som Intl:s SEK-valuta (den gamla formatCurrency)", () => {
    const sek = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });
    for (const ore of [0, 1, 99, 100_000, 123_450, -29_700, 162_600]) {
      expect(formatKr(ore)).toBe(sek.format(ore / 100));
    }
  });
});

describe("formatRateKr", () => {
  it("decimaler bara när öre finns, hårt mellanslag före kr", () => {
    expect(formatRateKr(162_600)).toBe(`1${NBSP}626${NBSP}kr`);
    expect(formatRateKr(97_550)).toBe(`975,50${NBSP}kr`);
  });
});
