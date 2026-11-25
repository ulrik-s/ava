/**
 * Tester för proposedAccontoOre (#397, #1726) — den delade aconto-formeln, inkl. moms:
 *   belopp = (%-sats (bips) × upparbetat värde, hela kr) + 25 % moms − Σ tidigare aconton, klampat ≥ 0.
 */

import { describe, it, expect } from "vitest-compat";
import { DEFAULT_ACCONTO_SHARE_BIPS, buildProposal, proposedAccontoOre } from "@/lib/shared/billing-proposal";

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
    const ex = [{ id: "e1", description: "Avgift", amount: 5_000, billable: true, date: "2026-03-05" }];
    const proposal = buildProposal(te, ex, 0, { paymentMethod: "PRIVAT" }, "2026-04-01");
    expect(proposal.timeEntries[0]?.date).toEqual(new Date("2026-03-02T09:00:00Z"));
    expect(proposal.expenses[0]?.date).toBe("2026-03-05");
  });
});
