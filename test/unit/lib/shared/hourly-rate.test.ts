/**
 * `hourly-rate` — vilket timpris en ny tidspost får (#1195, #1199).
 * Beloppen är i öre/h.
 */

import { describe, it, expect } from "vitest-compat";
import { hourlyRateForKind, isTidsspillanKind, type HourlyRateSources } from "@/lib/shared/hourly-rate";

const rates = (o: Partial<HourlyRateSources> = {}): HourlyRateSources => ({
  matterRate: null, userRate: null, orgDefaultRate: null, orgTidsspillanRate: null, ...o,
});

describe("isTidsspillanKind", () => {
  it("båda tidsspillan-kategorierna, inget annat", () => {
    expect(isTidsspillanKind("TIDSSPILLAN")).toBe(true);
    expect(isTidsspillanKind("TIDSSPILLAN_OVRIG_TID")).toBe(true);
    expect(isTidsspillanKind("ARBETE")).toBe(false);
    expect(isTidsspillanKind("ADVOKATBEREDSKAP")).toBe(false);
    expect(isTidsspillanKind(null)).toBe(false);
    expect(isTidsspillanKind(undefined)).toBe(false);
  });
});

describe("hourlyRateForKind", () => {
  it("arbete: ärende → jurist → byrå → 0", () => {
    expect(hourlyRateForKind("ARBETE", rates({ matterRate: 450_000, userRate: 300_000, orgDefaultRate: 200_000 }))).toBe(450_000);
    expect(hourlyRateForKind("ARBETE", rates({ userRate: 300_000, orgDefaultRate: 200_000 }))).toBe(300_000);
    expect(hourlyRateForKind(undefined, rates({ orgDefaultRate: 200_000 }))).toBe(200_000);
    expect(hourlyRateForKind(null, rates())).toBe(0);
  });

  it("arbete påverkas inte av tidsspillan-priset", () => {
    expect(hourlyRateForKind("ARBETE", rates({ userRate: 300_000, orgTidsspillanRate: 150_000 }))).toBe(300_000);
  });

  it("tidsspillan med satt pris: byråns tidsspillan-pris vinner över hela kedjan", () => {
    const r = rates({ matterRate: 450_000, userRate: 300_000, orgDefaultRate: 200_000, orgTidsspillanRate: 150_000 });
    expect(hourlyRateForKind("TIDSSPILLAN", r)).toBe(150_000);
    expect(hourlyRateForKind("TIDSSPILLAN_OVRIG_TID", r)).toBe(150_000);
  });

  it("tidsspillan-pris 0 är ett satt pris (gratis tidsspillan)", () => {
    expect(hourlyRateForKind("TIDSSPILLAN", rates({ userRate: 300_000, orgTidsspillanRate: 0 }))).toBe(0);
  });

  it("tidsspillan utan satt pris: samma timpris som arbete", () => {
    expect(hourlyRateForKind("TIDSSPILLAN", rates({ userRate: 300_000 }))).toBe(300_000);
    expect(hourlyRateForKind("TIDSSPILLAN_OVRIG_TID", rates({ orgDefaultRate: 200_000 }))).toBe(200_000);
  });
});
