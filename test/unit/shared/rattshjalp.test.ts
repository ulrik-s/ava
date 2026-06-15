/**
 * Tester för rättshjälps-billing (#349): rådgivningsavgiften (1 h enligt
 * timkostnadsnormen) och ärende-sammanställningen för slutfakturan.
 */

import { describe, it, expect } from "vitest-compat";
import {
  TIMKOSTNADSNORM_FTAX_ORE_PER_H,
  TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H,
} from "@/lib/shared/brottmalstaxa";
import {
  computeRadgivningsavgift,
  computeMatterSettlement,
  RADGIVNING_MINUTES,
} from "@/lib/shared/rattshjalp";

describe("computeRadgivningsavgift", () => {
  it("är en timme enligt timkostnadsnormen (F-skatt)", () => {
    const r = computeRadgivningsavgift();
    expect(r.minutes).toBe(RADGIVNING_MINUTES);
    expect(r.minutes).toBe(60);
    expect(r.rateOrePerH).toBe(TIMKOSTNADSNORM_FTAX_ORE_PER_H);
    expect(r.beloppExclVatOre).toBe(TIMKOSTNADSNORM_FTAX_ORE_PER_H); // 1 h
  });

  it("F-skatt-justeras nedåt utan F-skatt", () => {
    const r = computeRadgivningsavgift({ hasFTax: false });
    expect(r.rateOrePerH).toBe(TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H);
    expect(r.beloppExclVatOre).toBe(TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H);
  });
});

describe("computeMatterSettlement", () => {
  it("summerar brutto, slutfaktura och utestående", () => {
    const s = computeMatterSettlement({
      arvodeOre: 500_000,
      utlaggOre: 50_000,
      accontoPaidOre: 100_000,
      paymentsOre: 0,
    });
    expect(s.bruttoOre).toBe(550_000);          // arvode + utlägg
    expect(s.slutfakturaOre).toBe(450_000);     // brutto − acconto
    expect(s.outstandingOre).toBe(450_000);     // inget betalt än
  });

  it("prutning (negativ) minskar bruttot", () => {
    const s = computeMatterSettlement({ arvodeOre: 600_000, utlaggOre: 0, prutningOre: -100_000 });
    expect(s.bruttoOre).toBe(500_000);
    expect(s.slutfakturaOre).toBe(500_000);
  });

  it("betalningar minskar utestående till noll", () => {
    const s = computeMatterSettlement({
      arvodeOre: 400_000, utlaggOre: 0, accontoPaidOre: 100_000, paymentsOre: 300_000,
    });
    expect(s.slutfakturaOre).toBe(300_000);
    expect(s.outstandingOre).toBe(0);
  });

  it("rådgivningstimmen redovisas separat (påverkar inte brutto/slutfaktura)", () => {
    const withR = computeMatterSettlement({ arvodeOre: 200_000, utlaggOre: 0, radgivningOre: 162_600 });
    const without = computeMatterSettlement({ arvodeOre: 200_000, utlaggOre: 0 });
    expect(withR.radgivningOre).toBe(162_600);
    expect(withR.bruttoOre).toBe(without.bruttoOre);       // ej inräknad i domstols-brutto
    expect(withR.slutfakturaOre).toBe(without.slutfakturaOre);
  });

  it("defaultar valfria poster till 0", () => {
    const s = computeMatterSettlement({ arvodeOre: 100_000, utlaggOre: 0 });
    expect(s.prutningOre).toBe(0);
    expect(s.accontoPaidOre).toBe(0);
    expect(s.paymentsOre).toBe(0);
    expect(s.radgivningOre).toBe(0);
    expect(s.outstandingOre).toBe(100_000);
  });
});
