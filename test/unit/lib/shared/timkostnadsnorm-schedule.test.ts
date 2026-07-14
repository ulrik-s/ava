/**
 * Årsvis timkostnadsnorm + tidsspillan (#891) — den retroaktiva höjningen bygger
 * på att normen slås upp per datum/år.
 */

import { describe, it, expect } from "vitest-compat";
import { timkostnadsnormFtaxForDate, tidsspillanFtaxForDate } from "@/lib/shared/brottmalstaxa";

describe("timkostnadsnorm per år (#891)", () => {
  it("timkostnadsnormen följer året (2025 = 1 602 kr, 2026 = 1 626 kr)", () => {
    expect(timkostnadsnormFtaxForDate("2025-11-15")).toBe(160_200);
    expect(timkostnadsnormFtaxForDate("2026-03-01")).toBe(162_600);
  });

  it("tidsspillan-normen följer året (2025 = 1 450 kr) och är lägre än arvodesnormen", () => {
    expect(tidsspillanFtaxForDate("2025-11-15")).toBe(145_000);
    expect(tidsspillanFtaxForDate("2026-03-01")).toBeLessThan(timkostnadsnormFtaxForDate("2026-03-01"));
  });

  it("okänt/framtida år faller tillbaka på senaste kända normen", () => {
    expect(timkostnadsnormFtaxForDate("2030-01-01")).toBe(162_600);
  });
});
