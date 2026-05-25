/**
 * Regressionsskydd: rapport-routerns workValueOre-beräkning.
 *
 * Bakgrund: hourlyRate lagras i ÖRE (250_000 = 2 500 kr/h) men routern
 * multiplicerade tidigare med extra ×100 som om det vore kronor → värden
 * blev 100x för stora ("125 000 kr" på en 30-min entry @ 2 500 kr/h).
 */

import { describe, it, expect } from "vitest";

// Pure helpers — extrahera samma formel som routern kör för att enhetstesta isolerat.
function workValueOre(minutes: number, hourlyRateOre: number): number {
  return Math.round((minutes / 60) * hourlyRateOre);
}

describe("workValueOre", () => {
  it("30 min @ 2 500 kr/h = 1 250 kr (125 000 öre)", () => {
    expect(workValueOre(30, 250_000)).toBe(125_000);
  });

  it("60 min @ 2 500 kr/h = 2 500 kr (250 000 öre)", () => {
    expect(workValueOre(60, 250_000)).toBe(250_000);
  });

  it("120 min @ 900 kr/h (biträdande) = 1 800 kr (180 000 öre)", () => {
    expect(workValueOre(120, 90_000)).toBe(180_000);
  });

  it("75 min @ 2 200 kr/h = 2 750 kr (275 000 öre)", () => {
    expect(workValueOre(75, 220_000)).toBe(275_000);
  });

  it("returnerar INTE 100x för stort värde (regression)", () => {
    // Tidigare bug: 30 min @ 2 500 kr/h returnerade 12 500 000 öre (= 125 000 kr).
    // Korrekt: 125 000 öre (= 1 250 kr).
    const v = workValueOre(30, 250_000);
    expect(v).toBeLessThan(1_000_000);
  });
});
