/**
 * Enhetstest för offentligt uppdrag per ärendetyp (#1639): exakt
 * namnmatchning mot byråns markerade lista.
 */

import { describe, it, expect } from "vitest-compat";
import { isPublicAssignmentType, lockedPaymentMethod } from "@/lib/shared/public-assignment";

const ORG = { publicAssignmentMatterTypes: ["Offentlig försvarare", "Målsägandebiträde"] };

describe("isPublicAssignmentType", () => {
  it("markerad ärendetyp är offentligt uppdrag", () => {
    expect(isPublicAssignmentType(ORG, "Målsägandebiträde")).toBe(true);
  });

  it("omarkerad typ, ingen typ eller annan stavning är det inte", () => {
    expect(isPublicAssignmentType(ORG, "Bodelning")).toBe(false);
    expect(isPublicAssignmentType(ORG, null)).toBe(false);
    expect(isPublicAssignmentType(ORG, "")).toBe(false);
    expect(isPublicAssignmentType(ORG, "målsägandebiträde")).toBe(false);
  });

  it("tom lista, byrå utan fältet, null och okänd byrå: inga markerade", () => {
    expect(isPublicAssignmentType({ publicAssignmentMatterTypes: [] }, "Bodelning")).toBe(false);
    expect(isPublicAssignmentType({}, "Bodelning")).toBe(false);
    expect(isPublicAssignmentType({ publicAssignmentMatterTypes: null }, "Bodelning")).toBe(false);
    expect(isPublicAssignmentType(null, "Bodelning")).toBe(false);
  });
});

describe("lockedPaymentMethod", () => {
  it("markerad typ låser till Offentligt uppdrag, annars inget lås", () => {
    expect(lockedPaymentMethod(ORG, "Offentlig försvarare")).toBe("OFFENTLIGT_UPPDRAG");
    expect(lockedPaymentMethod(ORG, "Bodelning")).toBeUndefined();
  });
});
