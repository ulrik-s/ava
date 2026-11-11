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
  const person = { role: "KLIENT", contact: { name: "Klienten", contactType: "PERSON" } } as const;
  const first = { role: "FORSAKRINGSBOLAG", contact: { name: "Bolag A", contactType: "INSURANCE_COMPANY" } } as const;
  const second = { role: "OVRIG", contact: { name: "Bolag B", contactType: "INSURANCE_COMPANY" } } as const;
  const adverse = { role: "MOTPART", contact: { name: "Motpartsbolag", contactType: "INSURANCE_COMPANY" } } as const;
  const adverseCounsel = { role: "MOTPARTSOMBUD", contact: { name: "Ombudsbolag", contactType: "INSURANCE_COMPANY" } } as const;

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

  it("hoppar över försäkringsbolag som är motpart eller motpartsombud", () => {
    expect(findInsuranceCompany([adverse])).toBeUndefined();
    expect(findInsuranceCompany([adverseCounsel])).toBeUndefined();
    expect(findInsuranceCompany([adverse, adverseCounsel, first])?.contact.name).toBe("Bolag A");
  });

  it("ger försäkringsbolag i vanlig roll", () => {
    expect(findInsuranceCompany([{ ...first, role: "OMBUD" }])?.contact.name).toBe("Bolag A");
  });
});

describe("hasInsuranceCompany oavsett roll (#1511 oförändrad)", () => {
  it("sant även när försäkringsbolaget är motpart", () => {
    expect(hasInsuranceCompany([{ contact: { contactType: "INSURANCE_COMPANY" } }])).toBe(true);
  });
});
