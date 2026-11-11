/**
 * Tester för täcknings-takets tröskel-logik (#793): rättsskydd (belopp) vs
 * rättshjälp (timmar), varningsgränserna (90 % / 80 tim / tak − 10 tim, #1519),
 * och null när inget tak gäller.
 */

import { describe, it, expect } from "vitest-compat";
import {
  coverageStatus, DEFAULT_RATTSHJALP_TIMMAR, RATTSHJALP_EXTENDED_MARGIN_TIMMAR, RATTSHJALP_WARN_RATIO,
} from "@/lib/shared/coverage-cap";

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

  it("rättsskydd: 89 % → ingen varning, 90 % → varning", () => {
    const cap = { ...base, method: "RATTSSKYDD" as const, rattsskyddMaxOre: 10_000_000 };
    expect(coverageStatus({ ...cap, billableValueOre: 8_900_000 })?.nearCap).toBe(false);
    expect(coverageStatus({ ...cap, billableValueOre: 9_000_000 })?.nearCap).toBe(true);
  });

  it("rättshjälp: default 100 tim, varnar vid 80 tim", () => {
    const s = coverageStatus({ ...base, method: "RATTSHJALP", billableMinutes: 80 * 60 })!;
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

  it.each([null, 100])("rättshjälp tak %s: 79:59 → ingen varning, 80:00 → varning", (tak) => {
    const rh = { ...base, method: "RATTSHJALP" as const, rattshjalpMaxTimmar: tak };
    expect(coverageStatus({ ...rh, billableMinutes: 80 * 60 - 1 })?.nearCap).toBe(false);
    expect(coverageStatus({ ...rh, billableMinutes: 80 * 60 })?.nearCap).toBe(true);
  });

  it("rättshjälp: utökat tak 150 → varnar 10 tim före (139:59 nej, 140:00 ja)", () => {
    const rh = { ...base, method: "RATTSHJALP" as const, rattshjalpMaxTimmar: 150 };
    expect(RATTSHJALP_EXTENDED_MARGIN_TIMMAR).toBe(10);
    expect(coverageStatus({ ...rh, billableMinutes: 140 * 60 - 1 })?.nearCap).toBe(false);
    const s = coverageStatus({ ...rh, billableMinutes: 140 * 60 });
    expect(s?.nearCap).toBe(true);
    expect(s?.overCap).toBe(false);
  });

  it("rättshjälp: tak under 100 (50 tim) → varnar vid 80 % (40 tim)", () => {
    const rh = { ...base, method: "RATTSHJALP" as const, rattshjalpMaxTimmar: 50 };
    expect(RATTSHJALP_WARN_RATIO).toBe(0.8);
    expect(coverageStatus({ ...rh, billableMinutes: 40 * 60 - 1 })?.nearCap).toBe(false);
    expect(coverageStatus({ ...rh, billableMinutes: 40 * 60 })?.nearCap).toBe(true);
  });

  it("rättshjälp: varningsgränsen räknas i hela minuter (tak 12 → 576 min, inget flyttalsfel)", () => {
    const rh = { ...base, method: "RATTSHJALP" as const, rattshjalpMaxTimmar: 12 };
    expect(coverageStatus({ ...rh, billableMinutes: 575 })?.nearCap).toBe(false);
    expect(coverageStatus({ ...rh, billableMinutes: 576 })?.nearCap).toBe(true);
  });

  it("rättshjälp: exakt 80 % ger varning för alla heltalstak 1–100", () => {
    for (let cap = 1; cap <= 100; cap++) {
      const s = coverageStatus({ ...base, method: "RATTSHJALP", rattshjalpMaxTimmar: cap, billableMinutes: 48 * cap });
      expect(s?.nearCap).toBe(true);
    }
  });

  it("rättshjälp: overCap först vid 100 % av taket", () => {
    const rh = { ...base, method: "RATTSHJALP" as const, rattshjalpMaxTimmar: 150 };
    expect(coverageStatus({ ...rh, billableMinutes: 150 * 60 - 1 })?.overCap).toBe(false);
    expect(coverageStatus({ ...rh, billableMinutes: 150 * 60 })?.overCap).toBe(true);
  });
});
