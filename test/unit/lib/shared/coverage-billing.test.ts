/**
 * Tester för prutnings-/självrisk-fördelningen (#800): rättsskydd (klient tar
 * mellanskillnaden, byrån hel) vs rättshjälp (byrån tappar, klient på reducerat).
 */

import { describe, it, expect } from "vitest-compat";
import { computeCoverageSplit } from "@/lib/shared/coverage-billing";

describe("computeCoverageSplit — rättsskydd (försäkring prutar)", () => {
  it("utan prutning: klient = självrisk, försäkring = resten, byrå hel", () => {
    // Total 100 000 kr, självrisk 20 % = 20 000 → försäkring 80 000.
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 10_000_000, clientShareBips: 2000, insurerPrutningOre: 0 });
    expect(r).toEqual({ clientOre: 2_000_000, payerOre: 8_000_000, firmLossOre: 0, effectiveTotalOre: 10_000_000 });
  });

  it("med prutning: klienten tar mellanskillnaden (självrisk + prutning), byrå hel", () => {
    // Självrisk 20 000 + bolagets prutning 15 000 = klient 35 000; försäkring 65 000.
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 10_000_000, clientShareBips: 2000, insurerPrutningOre: 1_500_000 });
    expect(r.clientOre).toBe(3_500_000);
    expect(r.payerOre).toBe(6_500_000);
    expect(r.firmLossOre).toBe(0);
    expect(r.clientOre + r.payerOre).toBe(10_000_000); // byrån blir hel
  });

  it("prutning större än försäkringens del → klient kapas vid total (aldrig > total)", () => {
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 10_000_000, clientShareBips: 2000, insurerPrutningOre: 99_000_000 });
    expect(r.clientOre).toBe(10_000_000);
    expect(r.payerOre).toBe(0);
  });
});

describe("computeCoverageSplit — rättshjälp (domstol prutar)", () => {
  it("utan reduktion (dom = total): klient = andel, stat = resten, ingen förlust", () => {
    const r = computeCoverageSplit({ method: "RATTSHJALP", totalOre: 10_000_000, clientShareBips: 2000, awardedOre: 10_000_000 });
    expect(r).toEqual({ clientOre: 2_000_000, payerOre: 8_000_000, firmLossOre: 0, effectiveTotalOre: 10_000_000 });
  });

  it("dom prutar: byrån tappar mellanskillnaden, klientens andel på det NYA beloppet", () => {
    // Total 100 000, dom 70 000 → byrå-förlust 30 000; klient 20 % × 70 000 = 14 000; stat 56 000.
    const r = computeCoverageSplit({ method: "RATTSHJALP", totalOre: 10_000_000, clientShareBips: 2000, awardedOre: 7_000_000 });
    expect(r.clientOre).toBe(1_400_000);
    expect(r.payerOre).toBe(5_600_000);
    expect(r.firmLossOre).toBe(3_000_000);
    expect(r.effectiveTotalOre).toBe(7_000_000);
    expect(r.clientOre + r.payerOre).toBe(7_000_000); // byrån får bara det reducerade
  });

  it("inget dombelopp angivet → ingen reduktion", () => {
    const r = computeCoverageSplit({ method: "RATTSHJALP", totalOre: 5_000_000, clientShareBips: 3000 });
    expect(r.firmLossOre).toBe(0);
    expect(r.clientOre).toBe(1_500_000);
  });
});

describe("computeCoverageSplit — övriga betalningssätt", () => {
  it("PRIVAT: hela totalen på klienten, ingen uppdelning", () => {
    const r = computeCoverageSplit({ method: "PRIVAT", totalOre: 4_000_000, clientShareBips: 0 });
    expect(r).toEqual({ clientOre: 4_000_000, payerOre: 0, firmLossOre: 0, effectiveTotalOre: 4_000_000 });
  });
});
