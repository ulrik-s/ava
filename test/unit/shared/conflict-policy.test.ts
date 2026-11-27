/**
 * conflictClassOf (ADR 0017 §3, reviderad efter ADR 0037, #1916): klassen
 * följer skrivsättet. Procedurägd → surface, radkö som bara läggs till →
 * append, radkö som får ändras → lww, oklassad → surface.
 */

import { describe, it, expect } from "vitest-compat";
import { conflictClassOf } from "@/lib/shared/conflict-policy";
import { PROCEDURE_OWNED_ENTITIES } from "@/lib/shared/sync/procedure-owned";

describe("conflictClassOf", () => {
  it("varje procedurägd entitet → surface", () => {
    for (const e of PROCEDURE_OWNED_ENTITIES) {
      expect(conflictClassOf(e)).toBe("surface");
    }
  });

  it("jävskontrollens logg (radkö, bara läggas till) → append", () => {
    expect(conflictClassOf("conflictCheck")).toBe("append");
  });

  it("radkö-entiteter som får ändras → lww", () => {
    for (const e of ["contact", "task", "calendarEvent", "document", "documentFolder", "documentPart", "serviceNote", "userPreference"]) {
      expect(conflictClassOf(e)).toBe("lww");
    }
  });

  it("pengar/tillstånd → surface", () => {
    expect(conflictClassOf("invoice")).toBe("surface");
    expect(conflictClassOf("paymentPlan")).toBe("surface");
    // Ärendets parter är procedurägda (#1883): en procedurägd entitet är surface.
    expect(conflictClassOf("matterContact")).toBe("surface");
  });

  it("oklassad entitet defaultar till surface (säkrast)", () => {
    expect(conflictClassOf("nånting-nytt")).toBe("surface");
  });
});
