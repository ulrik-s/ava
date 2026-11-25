/**
 * Enhetstest för offentligt uppdrag per ärendetyp (#1639): exakt
 * namnmatchning mot byråns markerade lista.
 */

import { describe, it, expect } from "vitest-compat";
import { isPublicAssignmentType, isTaxeMatter, lockedPaymentMethod } from "@/lib/shared/public-assignment";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/shared/schemas/enums";

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

// #1971: ett taxeärende är offentligt uppdrag OCH taxeflaggan.
describe("isTaxeMatter", () => {
  const methods = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

  it("alla sex betalningssätt finns med", () => {
    expect(methods).toHaveLength(6);
  });

  it("sann bara för offentligt uppdrag med flaggan true", () => {
    for (const paymentMethod of methods) {
      expect(isTaxeMatter({ paymentMethod, isTaxeArende: true })).toBe(paymentMethod === "OFFENTLIGT_UPPDRAG");
      expect(isTaxeMatter({ paymentMethod, isTaxeArende: false })).toBe(false);
      expect(isTaxeMatter({ paymentMethod, isTaxeArende: null })).toBe(false);
      expect(isTaxeMatter({ paymentMethod })).toBe(false);
    }
  });

  it("saknat eller null betalningssätt ger falskt", () => {
    expect(isTaxeMatter({ isTaxeArende: true })).toBe(false);
    expect(isTaxeMatter({ paymentMethod: null, isTaxeArende: true })).toBe(false);
    expect(isTaxeMatter({})).toBe(false);
  });
});
