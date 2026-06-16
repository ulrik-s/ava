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

  it("avrundar bråkdels-ören (3333 bips × 100 öre)", () => {
    // 100 × 3333 / 10000 = 33.33 → 33
    expect(proposedAccontoOre(100, 3333, 0)).toBe(33);
  });
});
