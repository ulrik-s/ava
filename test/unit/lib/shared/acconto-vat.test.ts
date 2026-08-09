/**
 * Aconto-avräkning (#968, modell A).
 *
 * Testerna vaktar tre saker som drar åt olika håll:
 *   • summan över acontofaktura + slutfaktura ska bli ärendets FAKTISKA moms
 *     och intäkt — varken mer (dagens dubbelbokföring) eller mindre,
 *   • momssatsen per rad får inte förskjutas (SIE bokför per sats, #790),
 *   • netto + moms måste alltid vara exakt bruttot, även efter avrundning.
 */
import { describe, it, expect } from "vitest-compat";

import { accontoCreditAmounts, accontoCreditLines, accontoSplit, deductAcconto } from "@/lib/shared/acconto-vat";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";

const arvode = (netOre: number): VatBreakdownLine => ({ kind: "arvode", vatRate: 2500, netOre, vatOre: Math.round(netOre * 0.25) });
const utlagg = (netOre: number, vatRate: number): VatBreakdownLine => ({ kind: "utlagg", vatRate, netOre, vatOre: Math.round((netOre * vatRate) / 10_000) });

const gross = (ls: readonly VatBreakdownLine[]): number => ls.reduce((s, l) => s + l.netOre + l.vatOre, 0);

/** Exakt uppsättningen från demons F-2026-0039 (öre) — fallet som fällde #968. */
const F0039: VatBreakdownLine[] = [
  { kind: "arvode", vatRate: 2500, netOre: 1_470_370, vatOre: 367_593 },
  { kind: "utlagg", vatRate: 0, netOre: 18_000, vatOre: 0 },
  { kind: "utlagg", vatRate: 600, netOre: 7_200, vatOre: 432 },
  { kind: "utlagg", vatRate: 1200, netOre: 12_800, vatOre: 1_536 },
  { kind: "utlagg", vatRate: 2500, netOre: 3_600, vatOre: 900 },
];
const F0039_ACCONTON = 955_100; // 6 299,00 + 3 252,00 kr

describe("accontoSplit", () => {
  it("delar ett acontobelopp i netto + 25 % moms", () => {
    expect(accontoSplit(629_900)).toEqual({ netOre: 503_920, vatOre: 125_980 });
  });

  it("netto + moms är alltid exakt bruttot (avrundning får inte tappa ören)", () => {
    for (const g of [1, 7, 99, 12_345, 629_900, 325_201]) {
      const { netOre, vatOre } = accontoSplit(g);
      expect(netOre + vatOre).toBe(g);
    }
  });
});

describe("deductAcconto", () => {
  it("F-2026-0039: momsen blir den som ÅTERSTÅR, inte hela fakturans", () => {
    // Kärnan i #968. Före fixen redovisade slutfakturan 3 704,61 kr moms trots
    // att acontona redan redovisat 1 910,20 kr av den — 1 910,20 kr dubbelt.
    const r = deductAcconto(F0039, F0039_ACCONTON);
    expect(r.deductedVatOre).toBe(191_020);
    expect(gross(r.lines)).toBe(gross(F0039) - F0039_ACCONTON);
    expect(r.lines.reduce((s, l) => s + l.vatOre, 0)).toBe(370_461 - 191_020);
    expect(r.overpaidGrossOre).toBe(0);
  });

  it("summan acontofaktura + slutfaktura = ärendets faktiska moms och intäkt", () => {
    // Det är HELA poängen med modell A: ingen krona bokförs två gånger.
    const acconto = accontoSplit(F0039_ACCONTON);
    const r = deductAcconto(F0039, F0039_ACCONTON);
    const restNet = r.lines.reduce((s, l) => s + l.netOre, 0);
    const restVat = r.lines.reduce((s, l) => s + l.vatOre, 0);
    expect(acconto.vatOre + restVat).toBe(370_461);
    expect(acconto.netOre + restNet).toBe(1_511_970);
  });

  it("kvittar mot 25 %-ARVODET först — inte mot utläggen", () => {
    // Acontot är rent arvode med 25 % moms. Att i stället nagga utläggsraderna
    // skulle flytta moms mellan 2611/2621/2631 i SIE-exporten (#790).
    const lines = [arvode(100_000), utlagg(50_000, 600)];
    const r = deductAcconto(lines, 125_000); // hela arvodet brutto (100 000 + 25 000)
    expect(r.lines).toEqual([utlagg(50_000, 600)]);
    expect(r.deductedVatOre).toBe(25_000);
  });

  it("spiller vidare när acontot överstiger arvodet — högsta sats först", () => {
    const lines = [arvode(10_000), utlagg(10_000, 600), utlagg(10_000, 2500)];
    // 12 500 (arvodet) + 12 500 (25 %-utlägget) = 25 000 → bara 6 %-raden kvar.
    const r = deductAcconto(lines, 25_000);
    expect(r.lines).toEqual([utlagg(10_000, 600)]);
  });

  it("bevarar radernas URSPRUNGLIGA ordning i utdatan", () => {
    // Avräkningsordningen är intern; fakturan och verifikatet ska se ut som förut.
    const lines = [utlagg(10_000, 600), arvode(100_000), utlagg(10_000, 1200)];
    const r = deductAcconto(lines, 12_500);
    expect(r.lines.map((l) => [l.kind, l.vatRate])).toEqual([
      ["utlagg", 600], ["arvode", 2500], ["utlagg", 1200],
    ]);
  });

  it("varje rad behåller sin momssats efter avräkning", () => {
    const r = deductAcconto(F0039, 500_000);
    for (const l of r.lines) {
      const expected = Math.round((l.netOre * l.vatRate) / 10_000);
      expect(Math.abs(l.vatOre - expected)).toBeLessThanOrEqual(1); // ören
    }
  });

  it("rader som går till noll faller bort — inga tomma verifikatrader", () => {
    const lines = [arvode(10_000), utlagg(10_000, 0)];
    const r = deductAcconto(lines, 12_500);
    expect(r.lines).toEqual([utlagg(10_000, 0)]);
  });

  it("aconto som överstiger hela fakturan → allt kvittat + överskottet rapporterat", () => {
    const lines = [arvode(10_000)]; // brutto 12 500
    const r = deductAcconto(lines, 20_000);
    expect(r.lines).toEqual([]);
    expect(r.deductedNetOre).toBe(10_000);
    expect(r.deductedVatOre).toBe(2_500);
    expect(r.overpaidGrossOre).toBe(7_500);
  });

  it("inget aconto → raderna orörda (ingen regression utan aconton)", () => {
    const r = deductAcconto(F0039, 0);
    expect(r.lines).toEqual(F0039);
    expect(r.deductedVatOre).toBe(0);
  });

  it("negativt avdrag behandlas som noll i stället för att blåsa upp fakturan", () => {
    expect(deductAcconto(F0039, -1000).lines).toEqual(F0039);
  });

  it("momsfri rad (0 %) kvittas utan att få moms påhängd", () => {
    const r = deductAcconto([utlagg(10_000, 0)], 4_000);
    expect(r.lines).toEqual([{ kind: "utlagg", vatRate: 0, netOre: 6_000, vatOre: 0 }]);
  });
});

describe("accontoCreditAmounts", () => {
  it("krediterar exakt det som blev för mycket bokfört", () => {
    const lines = [arvode(10_000)]; // netto 10 000, moms 2 500
    const c = accontoCreditAmounts(lines, 20_000); // aconto: netto 16 000, moms 4 000
    expect(c).toEqual({ netOre: 6_000, vatOre: 1_500 });
    expect(c.netOre + c.vatOre).toBe(20_000 - 12_500); // = överbetalningen
  });

  it("räknar rätt även när fakturan bär andra momssatser än acontots 25 %", () => {
    // Förr räknades krediteringens moms som 25 % av mellanskillnaden rakt av.
    // Med ett momsfritt utlägg på fakturan blir det fel: acontot bar 25 % moms
    // på HELA sitt belopp, fakturan bär mindre.
    const lines = [utlagg(10_000, 0)]; // brutto 10 000, moms 0
    const c = accontoCreditAmounts(lines, 20_000); // aconto: netto 16 000, moms 4 000
    expect(c).toEqual({ netOre: 6_000, vatOre: 4_000 });
    expect(c.netOre + c.vatOre).toBe(20_000 - 10_000);
    // Den gamla formeln (25 % av 10 000) hade gett 2 000 kr moms — 2 000 för lite.
  });
});

describe("accontoCreditLines", () => {
  it("summerar till kreditbeloppet — annars balanserar inte verifikatet", () => {
    const lines = [arvode(400_000)];
    const credit = accontoCreditLines(lines, 900_000);
    const amounts = accontoCreditAmounts(lines, 900_000);
    expect(gross(credit)).toBe(-(amounts.netOre + amounts.vatOre));
  });

  it("behåller fakturans rader och lägger acontot med OMVÄNT tecken", () => {
    // Det är den enda formen som kan uttrycka att arvodesintäkten minskar
    // samtidigt som utläggsintäkten ökar (#977).
    const lines = [arvode(400_000), utlagg(80_000, 2500)];
    expect(accontoCreditLines(lines, 900_000)).toEqual([
      ...lines,
      { kind: "arvode", vatRate: 2500, netOre: -720_000, vatOre: -180_000 },
    ]);
  });

  it("äkta utlägg (0 %) förblir momsfritt i krediteringen", () => {
    const credit = accontoCreditLines([utlagg(90_000, 0)], 100_000);
    expect(credit[0]).toEqual({ kind: "utlagg", vatRate: 0, netOre: 90_000, vatOre: 0 });
    expect(credit[1]).toEqual({ kind: "arvode", vatRate: 2500, netOre: -80_000, vatOre: -20_000 });
  });

  it("utan aconton är krediteringen noll — inget att vända", () => {
    const credit = accontoCreditLines([arvode(400_000)], 0);
    expect(gross(credit)).toBe(gross([arvode(400_000)]));
  });
});
