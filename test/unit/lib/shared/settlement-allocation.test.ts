/**
 * Slutregleringens fördelning (#1438): totalen räknas en gång, klienten får sin
 * andel av totalen INKL moms och betalaren resten; varje faktura delar sitt
 * brutto i netto (hela kronor) och moms.
 */

import { describe, expect, it } from "vitest-compat";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import type { UnfrozenWork } from "@/lib/shared/billing-work-value";
import { asId } from "@/lib/shared/schemas/ids";
import { allocate, allocateSettlement, linesWithGross, settlementAmounts, type SettlementAllocationInput } from "@/lib/shared/settlement-allocation";

const NO_WORK: UnfrozenWork = { timeEntries: [], expenses: [] };
const gross = (ls: readonly VatBreakdownLine[]): number => ls.reduce((s, l) => s + l.netOre + l.vatOre, 0);

/** 3 252 kr arvode (+ 813 kr moms = 4 065 kr) och ett utlägg på 100 kr (+ 25 kr). */
const WORK: UnfrozenWork = {
  timeEntries: [],
  expenses: [{ id: asId<"ExpenseId">("ex-1"), amount: 10_000, billable: true, vatRate: 2500, vatIncluded: false }],
};

function input(o: Partial<SettlementAllocationInput>): SettlementAllocationInput {
  return { method: "RATTSHJALP", totalArvodeNet: 325_200, work: WORK, clientShareBips: 2000, awardedOre: null, coverage: {}, ...o };
}

describe("allocate", () => {
  it("fördelar proportionellt i hela kronor och låter sista posten ta resten", () => {
    expect(allocate(100_000, [1, 1, 1])).toEqual([33_300, 33_300, 33_400]);
    expect(allocate(100_037, [3, 1])).toEqual([75_000, 25_037]);
  });

  it("utan vikter blir allt noll utom sista posten", () => {
    expect(allocate(500, [0, 0])).toEqual([0, 500]);
    expect(allocate(500, [])).toEqual([]);
  });
});

describe("linesWithGross", () => {
  it("delar varje momssats brutto i netto (hela kronor) och moms, och tappar tomma rader", () => {
    const lines: VatBreakdownLine[] = [
      { kind: "arvode", vatRate: 2500, netOre: 0, vatOre: 0 },
      { kind: "utlagg", vatRate: 2500, netOre: 0, vatOre: 0 },
      { kind: "utlagg", vatRate: 0, netOre: 0, vatOre: 0 },
      { kind: "utlagg", vatRate: 600, netOre: 0, vatOre: 0 },
    ];
    const out = linesWithGross(lines, [81_300, 2_500, 1_234, 0]);
    expect(gross(out)).toBe(85_034);
    expect(out).toHaveLength(3);
    // 25 %-gruppen: 838 kr brutto → 670 kr netto, fördelat 650 + 20.
    expect(out[0]).toEqual({ kind: "arvode", vatRate: 2500, netOre: 65_000, vatOre: 16_300 });
    expect(out[1]).toEqual({ kind: "utlagg", vatRate: 2500, netOre: 2_000, vatOre: 500 });
    expect(out[2]).toEqual({ kind: "utlagg", vatRate: 0, netOre: 1_234, vatOre: 0 });
  });
});

describe("allocateSettlement — rättshjälp", () => {
  it("utan beslut: totalen är fakturans uträkning, klienten 20 % inkl moms, betalaren resten", () => {
    const a = allocateSettlement(input({}));
    expect(a.totalGrossOre).toBe(419_000);
    expect(a.clientGrossOre).toBe(83_800);
    expect(a.payerGrossOre).toBe(335_200);
    expect(gross(a.clientLines) + gross(a.payerLines)).toBe(a.totalGrossOre);
    expect({ arvode: a.arvodeLossNetOre, expense: a.expenseLossNetOre, base: a.expensesBaseNetOre }).toEqual({ arvode: 0, expense: 0, base: 10_000 });
    expect(a.split).toEqual({ clientOre: 67_000, payerOre: 268_200, firmLossOre: 0, effectiveTotalOre: 335_200 });
  });

  it("med beslut tas beloppet som det är — även med ören — och byrån bär nedsättningen", () => {
    const a = allocateSettlement(input({ awardedOre: 300_037 }));
    expect(a.totalGrossOre).toBe(300_037);
    expect(a.clientGrossOre + a.payerGrossOre).toBe(300_037);
    expect(a.clientGrossOre).toBe(60_000); // 20 % av 3 000,37 kr
    expect(a.arvodeLossNetOre + a.expenseLossNetOre).toBeGreaterThan(0);
    expect(a.arvodeLossNetOre % 100).toBe(0);
  });

  it("utan arvode och utlägg finns inget att fördela", () => {
    const a = allocateSettlement(input({ totalArvodeNet: 0, work: NO_WORK }));
    expect({ total: a.totalGrossOre, client: a.clientLines, payer: a.payerLines }).toEqual({ total: 0, client: [], payer: [] });
  });
});

describe("allocateSettlement — rättsskydd", () => {
  const rs = (o: Partial<SettlementAllocationInput>): SettlementAllocationInput =>
    input({ method: "RATTSSKYDD", work: NO_WORK, ...o });

  it("självrisken är andelen av totalen inkl moms; bolagets prutning läggs på med moms", () => {
    const a = allocateSettlement(rs({ insurerPrutningOre: 50_000 }));
    expect(a.totalGrossOre).toBe(406_500);
    expect(a.clientGrossOre).toBe(81_300 + 62_500);
    expect(a.payerGrossOre).toBe(406_500 - 143_800);
    expect(a.split.clientParts).toEqual({ uncoveredOre: 0, sjalvriskOre: 65_000, prutningOre: 50_000, overCapOre: 0 });
  });

  it("otäckt arbete, lägsta självrisk och taket räknas på totalen — och posterna summerar till klientens netto", () => {
    const a = allocateSettlement(rs({ coverage: { coveredOre: 162_600, minSjalvriskOre: 180_000, capOre: 10_000 } }));
    // Täckt halva totalen (2 032,50 → 2 033 kr); självrisk lägst 2 250 kr inkl moms ⇒ hela täckta delen.
    expect(a.clientGrossOre + a.payerGrossOre).toBe(406_500);
    const parts = a.split.clientParts;
    expect(parts && parts.uncoveredOre + parts.sjalvriskOre + parts.prutningOre + parts.overCapOre).toBe(a.split.clientOre);
  });

  it("med taket når försäkringen högst maxbeloppet (inkl moms)", () => {
    const a = allocateSettlement(rs({ coverage: { capOre: 100_000 } }));
    expect(a.payerGrossOre).toBe(125_000);
    expect(a.split.clientParts?.overCapOre).toBeGreaterThan(0);
  });

  it("utan arvode räknas den täckta delen inte om", () => {
    const a = allocateSettlement(rs({ totalArvodeNet: 0, coverage: { coveredOre: 0 } }));
    expect(a.totalGrossOre).toBe(0);
  });
});

describe("settlementAmounts", () => {
  it("delar klientens och betalarens rader i arvode och utlägg", () => {
    const a = allocateSettlement(input({}));
    const m = settlementAmounts(a);
    expect(m.sjalvriskGrossOre + m.clientExpensesGrossOre).toBe(a.clientGrossOre);
    expect(m.payerArvodeNetOre + m.payerArvodeVatOre + m.expensesGrossOre).toBe(a.payerGrossOre);
    expect(m.clientExpensesNetOre + m.clientExpensesVatOre).toBe(m.clientExpensesGrossOre);
    expect(m.payerExpensesNetOre + m.payerExpensesVatOre).toBe(m.expensesGrossOre);
  });
});
