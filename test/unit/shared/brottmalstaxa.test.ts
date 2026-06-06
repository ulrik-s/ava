/**
 * Tester för brottmålstaxa (DVFS 2025:6). Belopp jämförs i öre.
 *
 * Källa: tabellen i DVFS 2025:6 Bilaga (sid 4-5). Spot-checks från
 * tabellen + edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  computeBrottmalstaxa,
  BROTTMALSTAXA_TABLE,
  TAXA_MAX_MINUTES,
  applyNoFTaxFactor,
} from "@/lib/shared/brottmalstaxa";

describe("computeBrottmalstaxa — spot checks från DVFS 2025:6", () => {
  // Nivå 1, 0-14 min → 2809 kr ex moms
  it("HUF 0 min, nivå 1, F-skatt → 2809 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1 });
    expect(r.kind).toBe("taxa-applies");
    expect(r.ersattningExclVat).toBe(280900);
    expect(r.gransvardeExclVat).toBe(421900);
    expect(r.intervalLabel).toBe("0-14 min");
  });

  it("HUF 14 min (slutet av intervallet) → samma som 0", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 14, level: 1 });
    expect(r.ersattningExclVat).toBe(280900);
  });

  it("HUF 15 min → hopp till nästa intervall (15-29 min, 2980 kr)", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 15, level: 1 });
    expect(r.ersattningExclVat).toBe(298000);
    expect(r.intervalLabel).toBe("15-29 min");
  });

  // Nivå 1, mellanintervall
  it("HUF 1 tim 30 min (90 min), nivå 1 → 5635 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 1 });
    expect(r.ersattningExclVat).toBe(563500);
    expect(r.intervalLabel).toBe("1 tim 30 min - 1 tim 44 min");
  });

  // Nivå 2 (häktningsförhandling)
  it("HUF 90 min, nivå 2 → 7011 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 2 });
    expect(r.ersattningExclVat).toBe(701100);
  });

  // Nivå 3 (RPU)
  it("HUF 90 min, nivå 3 → 8296 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 3 });
    expect(r.ersattningExclVat).toBe(829600);
  });

  // Nivå 4 (häktning + RPU)
  it("HUF 90 min, nivå 4 → 9672 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 4 });
    expect(r.ersattningExclVat).toBe(967200);
  });

  // Sista intervallet
  it("HUF 225 min (3 tim 45 min), nivå 1 → 9887 kr (taxans tak)", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 225, level: 1 });
    expect(r.kind).toBe("taxa-applies");
    expect(r.ersattningExclVat).toBe(988700);
    expect(r.intervalLabel).toBe("3 tim 30 min - 3 tim 45 min");
  });

  it("HUF 226 min → exceeds-max", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 226, level: 1 });
    expect(r.kind).toBe("exceeds-max");
    expect(r.notes.join(" ")).toMatch(/tillämpas inte/);
  });

  it("Stort HUF (8 timmar) → exceeds-max", () => {
    expect(computeBrottmalstaxa({ huvudforhandlingMinutes: 480, level: 4 }).kind).toBe("exceeds-max");
  });
});

describe("F-skatt-justering", () => {
  it("hasFTax=false → multiplicerar med 1237/1626", () => {
    const withFTax = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1, hasFTax: true });
    const withoutFTax = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1, hasFTax: false });
    const expected = Math.round((withFTax.ersattningExclVat * 1237) / 1626);
    expect(withoutFTax.ersattningExclVat).toBe(expected);
    expect(withoutFTax.notes.join(" ")).toMatch(/F-skatt/);
  });

  it("applyNoFTaxFactor — 2809 kr × 1237/1626 = ca 2137 kr", () => {
    // 280900 * 1237 / 1626 = 213697.59... → 213698 öre
    expect(applyNoFTaxFactor(280900)).toBe(213698);
  });
});

describe("Validering", () => {
  it("negativ HUF → invalid-input", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: -1, level: 1 });
    expect(r.kind).toBe("invalid-input");
  });

  it("nivå 5 → invalid-input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 60, level: 5 as any });
    expect(r.kind).toBe("invalid-input");
  });

  it("NaN HUF → invalid-input", () => {
    expect(computeBrottmalstaxa({ huvudforhandlingMinutes: NaN, level: 1 }).kind).toBe("invalid-input");
  });
});

describe("Tabellintegritet", () => {
  it("har 15 intervaller (0-14 till 210-225)", () => {
    expect(BROTTMALSTAXA_TABLE).toHaveLength(15);
  });

  it("varje intervall är 15 min (utom sista som är 16 = 210-225)", () => {
    for (const r of BROTTMALSTAXA_TABLE) {
      const width = r.toMin - r.fromMin + 1;
      expect(width === 15 || (r.fromMin === 210 && width === 16)).toBe(true);
    }
  });

  it("intervallen är sammanhängande (ingen lucka)", () => {
    for (let i = 1; i < BROTTMALSTAXA_TABLE.length; i++) {
      expect(BROTTMALSTAXA_TABLE[i]!.fromMin).toBe(BROTTMALSTAXA_TABLE[i - 1]!.toMin + 1);
    }
  });

  it("täcker exakt 0 till TAXA_MAX_MINUTES", () => {
    expect(BROTTMALSTAXA_TABLE[0]!.fromMin).toBe(0);
    expect(BROTTMALSTAXA_TABLE[BROTTMALSTAXA_TABLE.length - 1]!.toMin).toBe(TAXA_MAX_MINUTES);
  });

  it("ersättning ökar monotont per nivå inom varje intervall", () => {
    for (const r of BROTTMALSTAXA_TABLE) {
      expect(r.ersattning[1]).toBeGreaterThan(r.ersattning[0]);
      expect(r.ersattning[2]).toBeGreaterThan(r.ersattning[1]);
      expect(r.ersattning[3]).toBeGreaterThan(r.ersattning[2]);
    }
  });

  it("ersättning ökar monotont mellan intervaller (nivå 1)", () => {
    for (let i = 1; i < BROTTMALSTAXA_TABLE.length; i++) {
      expect(BROTTMALSTAXA_TABLE[i]!.ersattning[0]).toBeGreaterThan(BROTTMALSTAXA_TABLE[i - 1]!.ersattning[0]!);
    }
  });

  it("gränsvärdet är alltid större än ersättningen", () => {
    for (const r of BROTTMALSTAXA_TABLE) {
      for (let lvl = 0; lvl < 4; lvl++) {
        expect(r.gransvarde[lvl]).toBeGreaterThan(r.ersattning[lvl]!);
      }
    }
  });
});
