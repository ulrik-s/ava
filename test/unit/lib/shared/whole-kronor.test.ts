/**
 * Radavrundningen (#1438): öresavrundning till hela kronor — 1–49 öre nedåt,
 * 50–99 öre uppåt — speglad för negativa belopp, och öret som förr på äldre
 * fakturor.
 */

import { describe, expect, it } from "vitest-compat";
import {
  CURRENT_ROUNDING, kronorQuotient, roundingOf, roundRow, roundToKronor, shareOfRow, splitGross, timeRowOre, vatOnRow,
} from "@/lib/shared/whole-kronor";

describe("roundToKronor — öresavrundning", () => {
  it.each([
    [0, 0], [49, 0], [50, 100], [99, 100], [100, 100], [149, 100], [150, 200], [123_449, 123_400], [123_450, 123_500],
  ])("%i öre → %i öre", (ore, expected) => {
    expect(roundToKronor(ore)).toBe(expected);
  });

  it("speglas för negativa belopp, så en kreditering avrundas som originalet", () => {
    expect(roundToKronor(-49)).toBe(0);
    expect(roundToKronor(-50)).toBe(-100);
    expect(roundToKronor(-150)).toBe(-200);
    expect(roundToKronor(-123_449)).toBe(-123_400);
  });

  it("ger aldrig −0", () => {
    expect(Object.is(roundToKronor(-10), 0)).toBe(true);
  });

  it("avrundar bråkdelar av öre", () => {
    expect(roundToKronor(149.99)).toBe(100);
    expect(roundToKronor(150.01)).toBe(200);
  });
});

describe("kronorQuotient — avrundning i en division", () => {
  it("exakt X,50 kr avrundas uppåt utan att först avrundas på öret", () => {
    // 522 min × 1 965 kr/h = 17 095,50 kr exakt.
    expect(kronorQuotient(522 * 196_500, 60)).toBe(1_709_600);
    // 1 649,4 öre ska bli 16 kr — en mellanavrundning till 1 649 öre ändrar inget,
    // men 1 649,6 → 1 650 öre skulle felaktigt bli 17 kr.
    expect(kronorQuotient(16_496, 10)).toBe(1_600);
  });

  it("speglar negativa täljare", () => {
    expect(kronorQuotient(-15_000, 100)).toBe(-200);
  });
});

describe("roundRow / vatOnRow / splitGross", () => {
  it("KRONOR är dagens avrundning", () => {
    expect(CURRENT_ROUNDING).toBe("KRONOR");
    expect(roundRow(12_345)).toBe(12_300);
  });

  it("ORE avrundar till helt öre som äldre fakturor", () => {
    expect(roundRow(12_345.6, "ORE")).toBe(12_346);
    expect(vatOnRow(225_000, 2500, "ORE")).toBe(56_250);
    expect(splitGross(100_100, 2500, "ORE")).toEqual({ netOre: 80_080, vatOre: 20_020 });
  });

  it("momsen räknas på nettot och avrundas till hela kronor", () => {
    expect(vatOnRow(225_000, 2500)).toBe(56_300); // 562,50 → 563 kr
    expect(vatOnRow(225_100, 2500)).toBe(56_300); // 562,75 → 563 kr
    expect(vatOnRow(10_000, 0)).toBe(0);
    expect(vatOnRow(10_000, 600)).toBe(600);
  });

  it("brutto delas i netto i hela kronor och moms som resten", () => {
    expect(splitGross(100_100, 2500)).toEqual({ netOre: 80_100, vatOre: 20_000 }); // 800,80 → 801 kr
    expect(splitGross(629_900, 2500)).toEqual({ netOre: 503_900, vatOre: 126_000 });
    expect(splitGross(5_000, 0)).toEqual({ netOre: 5_000, vatOre: 0 });
    expect(splitGross(1_234, 0)).toEqual({ netOre: 1_234, vatOre: 0 }); // momsfritt med ören: allt netto
  });

  it("netto + moms är alltid exakt bruttot", () => {
    for (const g of [1, 7, 99, 12_345, 629_900, 325_201, -100_100]) {
      const { netOre, vatOre } = splitGross(g, 2500);
      expect(netOre + vatOre).toBe(g);
    }
  });
});

describe("shareOfRow / timeRowOre", () => {
  it("andelen avrundas till hela kronor", () => {
    expect(shareOfRow(325_200, 2000)).toBe(65_000); // 650,40 → 650 kr
    expect(shareOfRow(325_250, 2000)).toBe(65_100); // 650,50 → 651 kr
  });

  it("tid × timpris blir en rad i hela kronor", () => {
    expect(timeRowOre(90, 97_500)).toBe(146_300); // 1 462,50 → 1 463 kr
    expect(timeRowOre(60, 162_600)).toBe(162_600);
  });
});

describe("roundingOf", () => {
  it("en faktura utan fältet är en äldre (öre)", () => {
    expect(roundingOf({})).toBe("ORE");
    expect(roundingOf({ amountRounding: null })).toBe("ORE");
    expect(roundingOf({ amountRounding: "KRONOR" })).toBe("KRONOR");
  });
});
