/**
 * Rättshjälpens slutreglering mot domstolens beslut (#1255): fakturorna summerar
 * exakt till det beviljade, och fullt beviljat ger ingen nedsättning.
 */

import { describe, expect, it } from "vitest-compat";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { type CoverageSplit, resolveAward, settleToAward, type SettlementLines } from "@/lib/shared/coverage-billing";

const SPLIT: CoverageSplit = { clientOre: 20_000, payerOre: 80_000, firmLossOre: 0, effectiveTotalOre: 100_000 };
const arvode = (netOre: number): VatBreakdownLine => ({ kind: "arvode", vatRate: 2500, netOre, vatOre: Math.round(netOre * 0.25) });
const utlagg: VatBreakdownLine = { kind: "utlagg", vatRate: 0, netOre: 5_000, vatOre: 0 };
const LINES: SettlementLines = { split: SPLIT, clientLines: [arvode(20_000)], payerLines: [utlagg, arvode(80_000)] };
const gross = (l: SettlementLines): number => [...l.clientLines, ...l.payerLines].reduce((s, x) => s + x.netOre + x.vatOre, 0);

describe("settleToAward", () => {
  it("lägger avrundningsresten på betalarens arvodesrad, och fördelningen följer med", () => {
    const out = settleToAward(LINES, "RATTSHJALP", gross(LINES) + 37);
    expect(gross(out)).toBe(gross(LINES) + 37);
    expect(out.payerLines[1]).toEqual({ kind: "arvode", vatRate: 2500, netOre: 80_030, vatOre: 20_007 });
    expect(out.payerLines[0]).toBe(utlagg);
    expect(out.clientLines).toBe(LINES.clientLines);
    expect(out.split).toEqual({ ...SPLIT, payerOre: 80_030 });
  });

  it("en negativ rest drar av på samma rad", () => {
    expect(gross(settleToAward(LINES, "RATTSHJALP", gross(LINES) - 124))).toBe(gross(LINES) - 124);
  });

  it("rör inget när beloppen redan stämmer, utan beslut, eller för andra betalningssätt", () => {
    expect(settleToAward(LINES, "RATTSHJALP", gross(LINES))).toBe(LINES);
    expect(settleToAward(LINES, "RATTSHJALP", null)).toBe(LINES);
    expect(settleToAward(LINES, "RATTSSKYDD", gross(LINES) + 37)).toBe(LINES);
  });

  it("utan arvodesrad hos betalaren lämnas raderna orörda", () => {
    const onlyExpense: SettlementLines = { ...LINES, payerLines: [utlagg] };
    expect(settleToAward(onlyExpense, "RATTSHJALP", 1)).toBe(onlyExpense);
  });
});

describe("resolveAward — beslutet mot det yrkade (#1255)", () => {
  const WORK = { timeEntries: [], expenses: [] };

  it("fullt beviljat yrkande ger ingen nedsättning, även när omräkningen på öret är högre", () => {
    // Omräknat 100 001 öre netto (125 001 brutto) mot yrkat och beviljat 125 000.
    expect(resolveAward("RATTSHJALP", 100_001, WORK, 125_000, 125_000).awardedArvodeNetOre).toBe(100_001);
  });

  it("utan körningens yrkande jämförs beslutet med omräkningen, som förut", () => {
    expect(resolveAward("RATTSHJALP", 100_001, WORK, 125_000).awardedArvodeNetOre).toBe(100_000);
  });
});
