/**
 * Tester för proposedAccontoOre (#397) — den delade aconto-formeln:
 *   belopp = %-sats (bips) × upparbetat värde − Σ tidigare aconton, klampat ≥ 0.
 */

import { describe, it, expect } from "vitest-compat";
import { proposedAccontoOre } from "@/lib/shared/billing-proposal";

describe("proposedAccontoOre", () => {
  it("20 % av 5000 kr utan tidigare aconton → 1000 kr", () => {
    expect(proposedAccontoOre(500_000, 2000, 0)).toBe(100_000);
  });

  it("drar av tidigare aconton: 20 % × 5000 − 600 = 400 kr", () => {
    expect(proposedAccontoOre(500_000, 2000, 60_000)).toBe(40_000);
  });

  it("klampar till 0 när tidigare aconton överstiger andelen", () => {
    expect(proposedAccontoOre(500_000, 2000, 200_000)).toBe(0);
  });

  it("0 % → 0 oavsett upparbetat", () => {
    expect(proposedAccontoOre(500_000, 0, 0)).toBe(0);
  });

  it("avrundar förslaget till hela kronor (#1438)", () => {
    // 33,33 % av 100 kr = 33,33 kr → 33 kr; 33,33 % av 1,50 kr = 0,50 kr → 1 kr.
    expect(proposedAccontoOre(10_000, 3333, 0)).toBe(3_300);
    expect(proposedAccontoOre(150, 3333, 0)).toBe(0);
    expect(proposedAccontoOre(300, 5000, 0)).toBe(200);
  });
});
