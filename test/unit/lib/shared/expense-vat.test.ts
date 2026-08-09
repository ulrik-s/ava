/**
 * Utläggsmoms enligt NJA 2005 s. 606 (#975).
 *
 * Regeln har två steg som är lätta att blanda ihop: räkna AV byråns ingående
 * moms, debitera SEDAN 25 % på det som blir kvar. Att bara byta sats till 25 %
 * utan avräkning ger fel belopp; att bara räkna av utan påslag ger också fel.
 * Testerna låser båda stegen — och undantaget för äkta utlägg.
 */
import { describe, it, expect } from "vitest-compat";

import { chargedExpenseLines, chargedVatOre, expenseNetOre } from "@/lib/shared/expense-vat";

describe("expenseNetOre — steg 1: räkna av byråns ingående moms", () => {
  it("tågbiljett lagrad netto behåller sitt netto", () => {
    expect(expenseNetOre({ amount: 100_000, vatRate: 600, vatIncluded: false })).toBe(100_000);
  });

  it("belopp lagrat INKL moms räknas ned till netto", () => {
    // 1 060 kr inkl 6 % → 1 000 kr netto.
    expect(expenseNetOre({ amount: 106_000, vatRate: 600, vatIncluded: true })).toBe(100_000);
  });

  it("saknad sats behandlas som 25 % (default sedan #782)", () => {
    expect(expenseNetOre({ amount: 100_000 })).toBe(100_000);
  });
});

describe("chargedVatOre — steg 2: 25 % på nettot", () => {
  it("lägger 25 % oavsett vad byrån betalade", () => {
    expect(chargedVatOre(100_000)).toBe(25_000);
  });

  it("avrundar till hela ören", () => {
    expect(chargedVatOre(3)).toBe(1);
  });
});

describe("chargedExpenseLines", () => {
  it("tågbiljett med 6 % debiteras 25 % på nettot — inte 6 %", () => {
    // Kärnan i #975: 1 000 kr netto ger 250 kr moms, inte 60 kr.
    expect(chargedExpenseLines([{ amount: 100_000, vatRate: 600 }])).toEqual([
      { kind: "utlagg", vatRate: 2500, netOre: 100_000, vatOre: 25_000 },
    ]);
  });

  it("blandade satser kollapsar till EN 25 %-rad på summan av nettona", () => {
    // Tåg 6 %, hotell 12 %, kopior 25 % → ett gemensamt underlag.
    const lines = chargedExpenseLines([
      { amount: 100_000, vatRate: 600 },
      { amount: 50_000, vatRate: 1200 },
      { amount: 10_000, vatRate: 2500 },
    ]);
    expect(lines).toEqual([{ kind: "utlagg", vatRate: 2500, netOre: 160_000, vatOre: 40_000 }]);
  });

  it("momsfritt utlägg (0 %) debiteras ändå 25 % — det är byråns omkostnad", () => {
    // Ansökningsavgiften är momsfri för DOMSTOLEN. Betalar byrån den som del av
    // uppdraget blir den ett kostnadselement och ska bära 25 % vidare.
    expect(chargedExpenseLines([{ amount: 90_000, vatRate: 0 }])).toEqual([
      { kind: "utlagg", vatRate: 2500, netOre: 90_000, vatOre: 22_500 },
    ]);
  });

  it("ÄKTA utlägg vidarefaktureras utan moms, på egen rad", () => {
    const lines = chargedExpenseLines([
      { amount: 100_000, vatRate: 600 },
      { amount: 90_000, vatRate: 0, passThrough: true },
    ]);
    expect(lines).toEqual([
      { kind: "utlagg", vatRate: 2500, netOre: 100_000, vatOre: 25_000 },
      { kind: "utlagg", vatRate: 0, netOre: 90_000, vatOre: 0 },
    ]);
  });

  it("äkta utlägg tar beloppet som-är — ingen ingående moms lyfts", () => {
    // Byrån har inte betalat momsen för egen räkning, så det finns inget att
    // räkna av. Hade vi kört `expenseNetOre` här hade beloppet krympt felaktigt.
    expect(chargedExpenseLines([{ amount: 106_000, vatRate: 600, passThrough: true }])).toEqual([
      { kind: "utlagg", vatRate: 0, netOre: 106_000, vatOre: 0 },
    ]);
  });

  it("passThrough=false är huvudregeln — undantaget måste sägas ut", () => {
    expect(chargedExpenseLines([{ amount: 100_000, vatRate: 600, passThrough: false }])[0]?.vatRate).toBe(2500);
    expect(chargedExpenseLines([{ amount: 100_000, vatRate: 600 }])[0]?.vatRate).toBe(2500);
  });

  it("inga utlägg → inga rader (fakturan ska inte bära nollrader)", () => {
    expect(chargedExpenseLines([])).toEqual([]);
    expect(chargedExpenseLines([{ amount: 0, vatRate: 600 }])).toEqual([]);
  });

  it("demons utläggsmoms: 3 182,20 kr → 3 965,00 kr", () => {
    // Regressionsvakt för hela datamängden. Sammansättningen är seedens:
    // 2 × 0 %, 2 × 6 %, 2 × 12 %, 22 × 25 % (netto ur demo-seed.json).
    const seed = [
      { amount: 90_000, vatRate: 0 }, { amount: 90_000, vatRate: 0 },
      { amount: 39_000, vatRate: 600 }, { amount: 39_000, vatRate: 600 },
      { amount: 71_000, vatRate: 1200 }, { amount: 71_000, vatRate: 1200 },
    ];
    const lines = chargedExpenseLines(seed);
    expect(lines[0]?.vatOre).toBe(100_000); // 400 000 netto × 25 %
    // Gamla modellen: 0 + 0 + 2 340 + 2 340 + 8 520 + 8 520 = 21 720 öre.
    expect(lines[0]?.vatOre).toBeGreaterThan(21_720);
  });
});
