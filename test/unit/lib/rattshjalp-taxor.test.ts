/**
 * Arvodeskategoriernas årsnormer (#950) — hämtade ur Domstolsverkets föreskrifter
 * ("Rättshjälp och taxor" 2025 resp. 2026). Testet låser beloppen så en felaktig
 * siffra inte kan smyga in, och verifierar att den RETROAKTIVA höjningen fungerar:
 * ett datum i 2025 slår upp 2025-normen, slutregleringen använder sitt eget år.
 */

import { describe, it, expect } from "vitest-compat";
import {
  timkostnadsnormFtaxForDate, tidsspillanFtaxForDate,
  tidsspillanOvrigFtaxForDate, arbeteObekvamFtaxForDate, advokatberedskapFtaxForDate,
  applyNoFTaxFactorForDate,
} from "@/lib/shared/brottmalstaxa";

describe("arvodeskategoriernas årsnormer (#950)", () => {
  it("2026 (DVFS 2025:4/:6/:7/:8)", () => {
    expect(timkostnadsnormFtaxForDate("2026-06-01")).toBe(162_600);  // 1 626 kr
    expect(tidsspillanFtaxForDate("2026-06-01")).toBe(148_700);      // 1 487 kr
    expect(tidsspillanOvrigFtaxForDate("2026-06-01")).toBe(97_500);  //   975 kr
    expect(arbeteObekvamFtaxForDate("2026-06-01")).toBe(325_600);    // 3 256 kr
    expect(advokatberedskapFtaxForDate("2026-06-01")).toBe(255_000); // 2 550 kr/dag
  });

  it("2025 (DVFS 2024:14/:15/:18/:19/:20)", () => {
    expect(timkostnadsnormFtaxForDate("2025-06-01")).toBe(158_600);  // 1 586 kr
    expect(tidsspillanFtaxForDate("2025-06-01")).toBe(145_000);      // 1 450 kr
    expect(tidsspillanOvrigFtaxForDate("2025-06-01")).toBe(95_100);  //   951 kr
    expect(arbeteObekvamFtaxForDate("2025-06-01")).toBe(317_500);    // 3 175 kr
    expect(advokatberedskapFtaxForDate("2025-06-01")).toBe(248_700); // 2 487 kr/dag
  });

  it("obekväm tid är alltid högre än ordinarie arvode, annan tid alltid lägre än dagtidsspillan", () => {
    for (const d of ["2025-06-01", "2026-06-01"]) {
      expect(arbeteObekvamFtaxForDate(d)).toBeGreaterThan(timkostnadsnormFtaxForDate(d));
      expect(tidsspillanOvrigFtaxForDate(d)).toBeLessThan(tidsspillanFtaxForDate(d));
      expect(tidsspillanFtaxForDate(d)).toBeLessThan(timkostnadsnormFtaxForDate(d));
    }
  });

  it("kvoten utan F-skatt är ÅRSBEROENDE — 1207/1586 (2025) resp. 1237/1626 (2026)", () => {
    // Normen utan F-skatt = normen med F-skatt × årets kvot.
    expect(applyNoFTaxFactorForDate(158_600, "2025-06-01")).toBe(120_700); // 1 207 kr
    expect(applyNoFTaxFactorForDate(162_600, "2026-06-01")).toBe(123_700); // 1 237 kr
    // Fel år ger fel belopp — det var buggen: 2026-kvoten på 2025-arbete.
    expect(applyNoFTaxFactorForDate(158_600, "2026-06-01")).not.toBe(120_700);
  });

  it("okänt år faller tillbaka på senaste kända normen (retroaktiv höjning landar där)", () => {
    expect(timkostnadsnormFtaxForDate("2099-01-01")).toBe(162_600);
    expect(arbeteObekvamFtaxForDate("2099-01-01")).toBe(325_600);
  });
});
