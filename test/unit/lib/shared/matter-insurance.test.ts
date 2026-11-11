/**
 * Villkoret för försäkringsreferensen (#1511): ärendet har ett försäkringsbolag.
 */

import { describe, it, expect } from "vitest-compat";
import { hasInsuranceCompany } from "@/lib/shared/matter-insurance";

describe("hasInsuranceCompany", () => {
  it("sant med minst ett försäkringsbolag bland kontakterna", () => {
    expect(hasInsuranceCompany([
      { contact: { contactType: "PERSON" } },
      { contact: { contactType: "INSURANCE_COMPANY" } },
    ])).toBe(true);
  });

  it("falskt utan försäkringsbolag, utan kontakter och utan kontakttyp", () => {
    expect(hasInsuranceCompany([{ contact: { contactType: "COMPANY" } }])).toBe(false);
    expect(hasInsuranceCompany([])).toBe(false);
    expect(hasInsuranceCompany([{ contact: {} }, { contact: { contactType: null } }])).toBe(false);
  });
});
