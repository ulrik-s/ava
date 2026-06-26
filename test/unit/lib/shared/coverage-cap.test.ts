/**
 * Tester för täcknings-takets tröskel-logik (#793): rättsskydd (belopp) vs
 * rättshjälp (timmar), 90 %-varning, och null när inget tak gäller.
 */

import { describe, it, expect } from "vitest-compat";
import { coverageStatus, DEFAULT_RATTSHJALP_TIMMAR } from "@/lib/shared/coverage-cap";

const base = { rattsskyddMaxOre: null, rattshjalpMaxTimmar: null, billableMinutes: 0, billableValueOre: 0 };

describe("coverageStatus", () => {
  it("annat betalningssätt → null (inget tak)", () => {
    expect(coverageStatus({ ...base, method: "PRIVAT", billableValueOre: 999_999 })).toBeNull();
  });

  it("rättsskydd utan satt maxbelopp → null (taket okänt)", () => {
    expect(coverageStatus({ ...base, method: "RATTSSKYDD" })).toBeNull();
  });

  it("rättsskydd: varnar vid ≥ 90 % av beloppstaket", () => {
    // Tak 100 000 kr, upparbetat 90 000 kr → 90 %.
    const s = coverageStatus({ ...base, method: "RATTSSKYDD", rattsskyddMaxOre: 10_000_000, billableValueOre: 9_000_000 })!;
    expect(s.kind).toBe("amount");
    expect(s.nearCap).toBe(true);
    expect(s.overCap).toBe(false);
  });

  it("rättsskydd: under 90 % → ingen varning", () => {
    const s = coverageStatus({ ...base, method: "RATTSSKYDD", rattsskyddMaxOre: 10_000_000, billableValueOre: 8_000_000 })!;
    expect(s.nearCap).toBe(false);
  });

  it("rättshjälp: default 100 tim, varnar vid 90 tim", () => {
    const s = coverageStatus({ ...base, method: "RATTSHJALP", billableMinutes: 90 * 60 })!;
    expect(s.kind).toBe("hours");
    expect(s.capOre).toBe(DEFAULT_RATTSHJALP_TIMMAR * 60);
    expect(s.nearCap).toBe(true);
    expect(s.overCap).toBe(false);
  });

  it("rättshjälp: över taket → overCap", () => {
    const s = coverageStatus({ ...base, method: "RATTSHJALP", billableMinutes: 105 * 60 })!;
    expect(s.overCap).toBe(true);
  });

  it("rättshjälp: utökat tak (150 tim) flyttar varningsgränsen", () => {
    // 100 tim upparbetat mot 150-tim-tak = 67 % → ingen varning.
    const s = coverageStatus({ ...base, method: "RATTSHJALP", rattshjalpMaxTimmar: 150, billableMinutes: 100 * 60 })!;
    expect(s.nearCap).toBe(false);
  });
});
