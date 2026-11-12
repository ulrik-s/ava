/**
 * Villkoret för försäkringsreferensen (#1511, #1532) och bolaget i ärendehuvudet
 * (#1518): ett försäkringsbolag som inte står på motsidan.
 */

import { describe, it, expect } from "vitest-compat";
import { findInsuranceCompany, hasInsuranceCompany } from "@/lib/shared/matter-insurance";

describe("hasInsuranceCompany (#1532)", () => {
  const insurer = (role: "FORSAKRINGSBOLAG" | "OVRIG" | "MOTPART" | "MOTPARTSOMBUD") =>
    ({ role, contact: { contactType: "INSURANCE_COMPANY" } }) as const;

  it("sant med ett försäkringsbolag i annan roll än motsidan", () => {
    expect(hasInsuranceCompany([{ role: "KLIENT", contact: { contactType: "PERSON" } }, insurer("FORSAKRINGSBOLAG")])).toBe(true);
    expect(hasInsuranceCompany([insurer("OVRIG")])).toBe(true);
  });

  it("falskt när försäkringsbolaget är motpart eller motpartsombud", () => {
    expect(hasInsuranceCompany([insurer("MOTPART")])).toBe(false);
    expect(hasInsuranceCompany([insurer("MOTPARTSOMBUD")])).toBe(false);
    expect(hasInsuranceCompany([insurer("MOTPART"), insurer("MOTPARTSOMBUD")])).toBe(false);
  });

  it("sant när ett av flera försäkringsbolag står utanför motsidan", () => {
    expect(hasInsuranceCompany([insurer("MOTPART"), insurer("FORSAKRINGSBOLAG")])).toBe(true);
  });

  it("falskt utan försäkringsbolag, utan kontakter och utan kontakttyp", () => {
    expect(hasInsuranceCompany([{ role: "OVRIG", contact: { contactType: "COMPANY" } }])).toBe(false);
    expect(hasInsuranceCompany([])).toBe(false);
    expect(hasInsuranceCompany([{ role: "OVRIG", contact: {} }, { role: "OVRIG", contact: { contactType: null } }])).toBe(false);
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
