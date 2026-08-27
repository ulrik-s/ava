/**
 * `toIsoDate` — utbruten ur tre privata kopior (#1035).
 *
 * Lokal tid, inte UTC: ett verifikat daterat 2026-01-01 kl. 00:30 svensk tid
 * ska bokföras på den 1 januari. `toISOString()` hade gett den 31 december och
 * lagt posten i fel räkenskapsår.
 */

import { describe, it, expect } from "vitest-compat";
import { toIsoDate } from "@/lib/shared/iso-date";

describe("toIsoDate", () => {
  it("nollutfyller månad och dag", () => {
    expect(toIsoDate(new Date(2026, 0, 3))).toBe("2026-01-03");
  });

  it("tar en datumsträng lika väl som ett Date", () => {
    expect(toIsoDate("2026-11-24")).toBe("2026-11-24");
  });

  it("använder LOKAL tid — strax efter midnatt hör till den nya dagen", () => {
    expect(toIsoDate(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
  });

  it("strax före midnatt hör till den gamla dagen", () => {
    expect(toIsoDate(new Date(2025, 11, 31, 23, 30))).toBe("2025-12-31");
  });
});
