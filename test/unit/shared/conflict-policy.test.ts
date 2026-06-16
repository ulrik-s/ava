/**
 * conflictClassOf (ADR 0017, #414) — entitets-matrisen append/lww/surface
 * + default-surface för oklassade entiteter.
 */

import { describe, it, expect } from "vitest-compat";
import { conflictClassOf } from "@/lib/shared/conflict-policy";

describe("conflictClassOf", () => {
  it("append-only entiteter → append", () => {
    for (const e of ["timeEntry", "expense", "payment", "billingRun", "writeOff", "calendarEvent"]) {
      expect(conflictClassOf(e)).toBe("append");
    }
  });

  it("beskrivande entiteter → lww", () => {
    for (const e of ["matter", "contact", "matterContact", "task", "serviceNote", "userPreference"]) {
      expect(conflictClassOf(e)).toBe("lww");
    }
  });

  it("pengar/tillstånd → surface", () => {
    expect(conflictClassOf("invoice")).toBe("surface");
    expect(conflictClassOf("paymentPlan")).toBe("surface");
  });

  it("oklassad entitet defaultar till surface (säkrast)", () => {
    expect(conflictClassOf("nånting-nytt")).toBe("surface");
  });
});
