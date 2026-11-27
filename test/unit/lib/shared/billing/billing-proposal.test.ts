/**
 * Tester för proposedAccontoOre (#397, #1726) — den delade aconto-formeln, inkl. moms:
 *   belopp = (%-sats (bips) × upparbetat värde, hela kr) + 25 % moms − Σ tidigare aconton, klampat ≥ 0.
 */

import { describe, it, expect } from "vitest-compat";
import {
  DEFAULT_ACCONTO_SHARE_BIPS,
  buildProposal,
  proposedAccontoOre,
  type ProposalExpenseInput,
} from "@/lib/shared/billing/billing-proposal";
import { expenseNetOre, matterArvodeNet } from "@/lib/shared/billing/billing-work-value";
import { asId } from "@/lib/shared/schemas/ids";

describe("proposedAccontoOre", () => {
  it("20 % av 5000 kr utan tidigare aconton → 1000 kr + moms = 1250 kr", () => {
    expect(proposedAccontoOre(500_000, 2000, 0)).toBe(125_000);
  });

  it("drar av tidigare aconton (brutto) från andelen inkl. moms: 1250 − 600 = 650 kr", () => {
    expect(proposedAccontoOre(500_000, 2000, 60_000)).toBe(65_000);
  });

  it("exempel: upparbetat 80 000 kr, andel 25 %, tidigare 5 000 kr → 20 000 kr (#1726)", () => {
    expect(proposedAccontoOre(8_000_000, 2500, 500_000)).toBe(2_000_000);
  });

  it("klampar till 0 när tidigare aconton överstiger andelen inkl. moms", () => {
    expect(proposedAccontoOre(500_000, 2000, 200_000)).toBe(0);
    expect(proposedAccontoOre(500_000, 2000, 125_000)).toBe(0);
  });

  it("0 % → 0 oavsett upparbetat", () => {
    expect(proposedAccontoOre(500_000, 0, 0)).toBe(0);
  });

  it("avrundar andelen till hela kronor (#1438) innan momsen läggs på", () => {
    // 33,33 % av 100 kr = 33,33 kr → 33 kr; + moms 8,25 kr → 8 kr = 41 kr.
    expect(proposedAccontoOre(10_000, 3333, 0)).toBe(4_100);
    // 33,33 % av 1,50 kr = 0,50 kr → 0 kr; ingen moms på 0.
    expect(proposedAccontoOre(150, 3333, 0)).toBe(0);
    // 50 % av 3 kr = 1,50 kr → 2 kr; + moms 0,50 kr → 1 kr = 3 kr.
    expect(proposedAccontoOre(300, 5000, 0)).toBe(300);
  });
});

describe("DEFAULT_ACCONTO_SHARE_BIPS (#1852)", () => {
  it("20 % när ärendet saknar egen andel", () => {
    expect(DEFAULT_ACCONTO_SHARE_BIPS).toBe(2000);
  });
});

describe("buildProposal — postens datum (#1888)", () => {
  it("datumet följer med för tidsposter och utlägg", () => {
    const te = [{ id: "t1", description: "Möte", minutes: 60, hourlyRate: 100_000, billable: true, date: new Date("2026-03-02T09:00:00Z") }];
    const ex = [{ id: asId<"ExpenseId">("e1"), description: "Avgift", amount: 5_000, billable: true, date: "2026-03-05" }];
    const proposal = buildProposal(te, ex, 0, { paymentMethod: "PRIVAT" }, "2026-04-01");
    expect(proposal.timeEntries[0]?.date).toEqual(new Date("2026-03-02T09:00:00Z"));
    expect(proposal.expenses[0]?.date).toBe("2026-03-05");
  });
});

// Förslaget räknar utläggen som fakturan (#1936): samma tal som createAcconto.
describe("buildProposal — utläggen räknas som fakturan (#1936)", () => {
  const DATE = "2026-04-01";
  const te = [{ id: "t1", description: "Arbete", minutes: 600, hourlyRate: 150_000, billable: true, date: "2026-03-02", kind: "ARBETE" as const }];
  const expense = (id: string, extra: Partial<ProposalExpenseInput>): ProposalExpenseInput => ({
    id: asId<"ExpenseId">(id), description: id, amount: 0, billable: true, date: "2026-03-05", ...extra,
  });
  /** 1 060 kr inkl. 6 % moms (netto 1 000 kr) och 123,45 kr utan moms (123 kr i hela kronor). */
  const ex = [
    expense("moms6", { amount: 106_000, vatRate: 600, vatIncluded: true }),
    expense("oren", { amount: 12_345, vatRate: 0, vatIncluded: false }),
  ];

  it("utlägg med moms inräknad och ören → samma underlag som createAcconto", () => {
    const matter = { paymentMethod: "RATTSHJALP" as const };
    const proposal = buildProposal(te, ex, 0, matter, DATE);
    const server = matterArvodeNet(matter, { timeEntries: te }, DATE) + expenseNetOre({ timeEntries: [], expenses: ex });
    expect(proposal.workValueOre).toBe(server);
    expect(expenseNetOre({ timeEntries: [], expenses: ex })).toBe(100_000 + 12_300);
  });

  it("förslaget på andelen blir det servern räknar: 20 % ger 15 kr mindre än med rått belopp", () => {
    const matter = { paymentMethod: "RATTSHJALP" as const };
    const proposal = buildProposal(te, [ex[0] ?? expense("x", {})], 0, matter, DATE);
    const raw = matterArvodeNet(matter, { timeEntries: te }, DATE) + 106_000;
    expect(proposedAccontoOre(proposal.workValueOre, DEFAULT_ACCONTO_SHARE_BIPS, 0)).toBe(
      proposedAccontoOre(raw, DEFAULT_ACCONTO_SHARE_BIPS, 0) - 1_500,
    );
  });

  it("PRUTNING och icke debiterbara utlägg räknas inte; listan är som förut", () => {
    const all = [
      ...ex,
      expense("prut", { amount: -50_000, kind: "PRUTNING" }),
      expense("egen", { amount: 40_000, billable: false }),
    ];
    const proposal = buildProposal([], all, 0, { paymentMethod: "PRIVAT" }, DATE);
    expect(proposal.workValueOre).toBe(112_300);
    expect(proposal.expenses.map((e) => [e.id, e.amount])).toEqual([["moms6", 106_000], ["oren", 12_345], ["egen", 40_000]]);
  });
});
