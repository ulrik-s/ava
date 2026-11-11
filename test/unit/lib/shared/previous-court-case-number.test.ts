/**
 * Regeln för tidigare målnummer (#1510).
 */

import { describe, it, expect } from "vitest-compat";
import { previousCourtCaseNumberAfterChange } from "@/lib/shared/previous-court-case-number";

describe("previousCourtCaseNumberAfterChange", () => {
  it("byte A→B ger tidigare A", () => {
    expect(previousCourtCaseNumberAfterChange("T 1-26", "T 2-26")).toBe("T 1-26");
  });

  it("nästa byte B→C ger tidigare B (bara ett tidigare nummer)", () => {
    expect(previousCourtCaseNumberAfterChange("T 2-26", "T 3-26")).toBe("T 2-26");
  });

  it("A→tomt lämnar tidigare orört", () => {
    expect(previousCourtCaseNumberAfterChange("T 1-26", null)).toBeUndefined();
    expect(previousCourtCaseNumberAfterChange("T 1-26", "")).toBeUndefined();
    expect(previousCourtCaseNumberAfterChange("T 1-26", "  ")).toBeUndefined();
  });

  it("A→A lämnar tidigare orört (även med omgivande blanksteg)", () => {
    expect(previousCourtCaseNumberAfterChange("T 1-26", "T 1-26")).toBeUndefined();
    expect(previousCourtCaseNumberAfterChange("T 1-26", " T 1-26 ")).toBeUndefined();
  });

  it("tomt→A ger inget tidigare", () => {
    expect(previousCourtCaseNumberAfterChange(null, "T 1-26")).toBeUndefined();
    expect(previousCourtCaseNumberAfterChange(undefined, "T 1-26")).toBeUndefined();
    expect(previousCourtCaseNumberAfterChange("", "T 1-26")).toBeUndefined();
  });

  it("målnumret utelämnat i uppdateringen lämnar tidigare orört", () => {
    expect(previousCourtCaseNumberAfterChange("T 1-26", undefined)).toBeUndefined();
  });
});
