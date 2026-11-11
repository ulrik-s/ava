/**
 * Villkoret för försäkringsreferensen (#1511): ärendet har ett försäkringsbolag.
 */

import { describe, it, expect } from "vitest-compat";
import { findInsuranceCompany, hasInsuranceCompany } from "@/lib/shared/matter-insurance";

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

describe("findInsuranceCompany (#1518)", () => {
  const person = { contact: { name: "Klienten", contactType: "PERSON" } };
  const first = { contact: { name: "Bolag A", contactType: "INSURANCE_COMPANY" } };
  const second = { contact: { name: "Bolag B", contactType: "INSURANCE_COMPANY" } };

  it("ger försäkringsbolaget med anroparens egen kontaktform", () => {
    expect(findInsuranceCompany([person, first])?.contact.name).toBe("Bolag A");
  });

  it("ger det första när flera försäkringsbolag finns", () => {
    expect(findInsuranceCompany([second, person, first])?.contact.name).toBe("Bolag B");
  });

  it("ger undefined utan försäkringsbolag", () => {
    expect(findInsuranceCompany([person])).toBeUndefined();
    expect(findInsuranceCompany([])).toBeUndefined();
  });
});
