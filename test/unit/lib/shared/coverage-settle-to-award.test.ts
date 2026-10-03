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
    // 5 kr mer beviljat → 4 kr netto + 1 kr moms, båda i hela kronor (#1438).
    const out = settleToAward(LINES, "RATTSHJALP", gross(LINES) + 500);
    expect(gross(out)).toBe(gross(LINES) + 500);
    expect(out.payerLines[1]).toEqual({ kind: "arvode", vatRate: 2500, netOre: 80_400, vatOre: 20_100 });
    expect(out.payerLines[0]).toBe(utlagg);
    expect(out.clientLines).toBe(LINES.clientLines);
    expect(out.split).toEqual({ ...SPLIT, payerOre: 80_400 });
  });

  it("ett beviljat belopp med ören tas som det är — örena hamnar på momsdelen (#1438)", () => {
    const out = settleToAward(LINES, "RATTSHJALP", gross(LINES) + 37);
    expect(gross(out)).toBe(gross(LINES) + 37);
    expect(out.payerLines[1]).toEqual({ kind: "arvode", vatRate: 2500, netOre: 80_000, vatOre: 20_037 });
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

  it("fullt beviljat yrkande ger ingen nedsättning, även när omräkningen är högre", () => {
    // Omräknat 1 001 kr netto (1 251 kr brutto) mot yrkat och beviljat 1 250 kr.
    expect(resolveAward("RATTSHJALP", 100_100, WORK, 125_000, 125_000).awardedArvodeNetOre).toBe(100_100);
  });

  it("utan körningens yrkande jämförs beslutet med omräkningen — nedsatt arvode i hela kronor", () => {
    expect(resolveAward("RATTSHJALP", 100_100, WORK, 125_000).awardedArvodeNetOre).toBe(100_000);
  });
});
