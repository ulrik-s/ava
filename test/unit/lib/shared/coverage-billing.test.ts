/**
 * Tester för prutnings-/självrisk-fördelningen (#800): rättsskydd (klient tar
 * mellanskillnaden, byrån hel) vs rättshjälp (byrån tappar, klient på reducerat).
 */

import { describe, it, expect } from "vitest-compat";
import { computeCoverageSplit, partitionRattsskyddMinutes, RATTSSKYDD_RETRO_MAX_MINUTES } from "@/lib/shared/coverage-billing";

describe("computeCoverageSplit — rättsskydd (försäkring prutar)", () => {
  it("utan prutning: klient = självrisk, försäkring = resten, byrå hel", () => {
    // Total 100 000 kr, självrisk 20 % = 20 000 → försäkring 80 000.
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 10_000_000, clientShareBips: 2000, insurerPrutningOre: 0 });
    // toMatchObject: beloppen är kontraktet — rättsskydd bär numera även en
    // additiv `clientParts`-nedbrytning (#935) som testas separat.
    expect(r).toMatchObject({ clientOre: 2_000_000, payerOre: 8_000_000, firmLossOre: 0, effectiveTotalOre: 10_000_000 });
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

  it("golv-självrisk (#899): 'lägst 1 800 kr' slår in när 20 % är lägre", () => {
    // Arvode 6 504 kr → 20 % = 1 300,80 kr < 1 800 kr → självrisk = 1 800 kr (golvet).
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 650_400, clientShareBips: 2000, minSjalvriskOre: 180_000 });
    expect(r.clientOre).toBe(180_000);          // golvet 1 800 kr
    expect(r.payerOre).toBe(650_400 - 180_000); // försäkringen resten
  });

  it("golv-självrisk påverkar inte när 20 % redan överstiger golvet", () => {
    // Arvode 100 000 kr → 20 % = 20 000 kr > 1 800 kr → självrisk = 20 000 kr.
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 10_000_000, clientShareBips: 2000, minSjalvriskOre: 180_000 });
    expect(r.clientOre).toBe(2_000_000);
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

describe("computeCoverageSplit — rättsskydd med täckt del + tak (#810)", () => {
  it("otäckt del (före tvist/retro-överskott) betalar klienten 100 %", () => {
    // total 1 000 000, täckt 600 000 (otäckt 400 000), självrisk 20 % × 600 000 = 120 000.
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 1_000_000, clientShareBips: 2000, coveredOre: 600_000 });
    expect(r.payerOre).toBe(480_000); // 600 000 − 120 000 självrisk
    expect(r.clientOre).toBe(520_000); // otäckt 400 000 + självrisk 120 000
    expect(r.clientOre + r.payerOre).toBe(1_000_000); // byrån hel
  });

  it("försäkringens tak kapar utbetalningen → överskott på klienten", () => {
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 1_000_000, clientShareBips: 2000, coveredOre: 600_000, capOre: 300_000 });
    expect(r.payerOre).toBe(300_000); // kapas vid taket (annars 480 000)
    expect(r.clientOre).toBe(700_000);
  });

  it("bolagets prutning på den täckta delen → klienten tar den", () => {
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 1_000_000, clientShareBips: 2000, coveredOre: 600_000, insurerPrutningOre: 50_000 });
    expect(r.payerOre).toBe(430_000); // 600 000 − 120 000 − 50 000
    expect(r.clientOre).toBe(570_000); // otäckt 400 000 + självrisk 120 000 + prutning 50 000
  });

  it("bakåtkompatibelt: utan coveredOre/capOre = allt täckt (gamla beteendet)", () => {
    const r = computeCoverageSplit({ method: "RATTSSKYDD", totalOre: 1_000_000, clientShareBips: 2000 });
    expect(r).toMatchObject({ clientOre: 200_000, payerOre: 800_000, firmLossOre: 0, effectiveTotalOre: 1_000_000 });
  });
});

describe("partitionRattsskyddMinutes — tidsuppdelning (#810)", () => {
  const entries = [
    { date: "2026-02-15", minutes: 120, billable: true },  // före tvist → ej täckt
    { date: "2026-03-10", minutes: 300, billable: true },  // retroaktivt
    { date: "2026-03-20", minutes: 180, billable: true },  // retroaktivt (totalt 480 > 360-taket)
    { date: "2026-03-12", minutes: 60, billable: false },  // ej debiterbar → hoppas över
    { date: "2026-04-15", minutes: 240, billable: true },  // efter beslut → täckt fullt
  ];

  it("före tvist exkluderas, retroaktivt kapas vid 6 h, efter beslut täcks fullt", () => {
    const p = partitionRattsskyddMinutes(entries, "2026-03-01", "2026-04-01");
    expect(p.preDisputeMinutes).toBe(120);
    expect(p.retroExcessMinutes).toBe(120); // 480 retro − 360 tak
    expect(p.coveredMinutes).toBe(360 + 240); // retro-tak + efter beslut
    expect(RATTSSKYDD_RETRO_MAX_MINUTES).toBe(360);
  });

  it("utan beslutsdatum: inget retroaktivt tak — allt från tvistdatum täcks", () => {
    const p = partitionRattsskyddMinutes(entries, "2026-03-01", null);
    expect(p.preDisputeMinutes).toBe(120);
    expect(p.retroExcessMinutes).toBe(0);
    expect(p.coveredMinutes).toBe(300 + 180 + 240); // allt billable från tvistdatum
  });

  it("utan tvistdatum: inget är 'före tvist'", () => {
    const p = partitionRattsskyddMinutes(entries, null, "2026-04-01");
    expect(p.preDisputeMinutes).toBe(0);
    // retro = 120 + 300 + 180 = 600 → kapas 360, överskott 240; efter beslut 240.
    expect(p.retroExcessMinutes).toBe(240);
    expect(p.coveredMinutes).toBe(360 + 240);
  });
});

describe("rättsskydd: nedbrytning av klientens andel (#935)", () => {
  const base = { method: "RATTSSKYDD" as const, totalOre: 1_000_000, clientShareBips: 2000 };

  /** Invarianten som gör itemiseringen trovärdig på fakturan. */
  const expectPartsSumToClient = (s: ReturnType<typeof computeCoverageSplit>): void => {
    const p = s.clientParts!;
    expect(p.uncoveredOre + p.sjalvriskOre + p.prutningOre + p.overCapOre).toBe(s.clientOre);
  };

  it("allt täckt: bara självrisk (20 %)", () => {
    const s = computeCoverageSplit(base);
    expect(s.clientParts).toEqual({ uncoveredOre: 0, sjalvriskOre: 200_000, prutningOre: 0, overCapOre: 0 });
    expectPartsSumToClient(s);
  });

  it("otäckt arbete särredovisas — klienten betalar 100 % av det", () => {
    const s = computeCoverageSplit({ ...base, coveredOre: 600_000 });
    expect(s.clientParts?.uncoveredOre).toBe(400_000);   // 1 000 000 − 600 000
    expect(s.clientParts?.sjalvriskOre).toBe(120_000);   // 20 % av täckt
    expectPartsSumToClient(s);
  });

  it("försäkringens prutning hamnar på egen rad", () => {
    const s = computeCoverageSplit({ ...base, insurerPrutningOre: 50_000 });
    expect(s.clientParts?.prutningOre).toBe(50_000);
    expect(s.clientParts?.sjalvriskOre).toBe(200_000);
    expectPartsSumToClient(s);
  });

  it("belopp över taket särredovisas", () => {
    const s = computeCoverageSplit({ ...base, capOre: 500_000 });
    // Försäkringen skulle betalat 800 000, taket 500 000 → 300 000 över taket.
    expect(s.clientParts?.overCapOre).toBe(300_000);
    expect(s.payerOre).toBe(500_000);
    expectPartsSumToClient(s);
  });

  it("golv-självrisk (dock lägst) speglas i nedbrytningen", () => {
    const s = computeCoverageSplit({ ...base, minSjalvriskOre: 300_000 });
    expect(s.clientParts?.sjalvriskOre).toBe(300_000); // golvet slår andel% (200 000)
    expectPartsSumToClient(s);
  });

  it("allt otäckt: självrisk/prutning kan inte överstiga täckt del", () => {
    const s = computeCoverageSplit({ ...base, coveredOre: 0, insurerPrutningOre: 50_000 });
    expect(s.payerOre).toBe(0);
    expect(s.clientOre).toBe(1_000_000);
    expect(s.clientParts).toEqual({ uncoveredOre: 1_000_000, sjalvriskOre: 0, prutningOre: 0, overCapOre: 0 });
    expectPartsSumToClient(s);
  });

  it("rättshjälp har ingen sådan nedbrytning (byrån bär prutningen)", () => {
    const s = computeCoverageSplit({ method: "RATTSHJALP", totalOre: 1_000_000, clientShareBips: 500, awardedOre: 800_000 });
    expect(s.clientParts).toBeUndefined();
    expect(s.firmLossOre).toBe(200_000);
  });
});
