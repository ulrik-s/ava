/**
 * Villkoret för försäkringsreferensen (#1511) och bolaget i ärendehuvudet
 * (#1518): rollen Försäkringsbolag avgör, inte kontakttypen (#1961).
 */

import { describe, it, expect } from "vitest-compat";
import { findInsuranceCompany, hasInsuranceCompany } from "@/lib/shared/matter-insurance";
import type { MatterRole } from "@/lib/shared/schemas/enums";

/** En part med roll och kontakttyp (saknad typ tillåten), som anroparna skickar. */
const party = (role: MatterRole, contactType?: string | null) => ({ role, contact: { name: `${role} ${contactType ?? "-"}`, contactType } });

describe("hasInsuranceCompany (#1961)", () => {
  it("sant med rollen Försäkringsbolag, oavsett kontakttyp", () => {
    expect(hasInsuranceCompany([party("KLIENT", "PERSON"), party("FORSAKRINGSBOLAG", "COMPANY")])).toBe(true);
    expect(hasInsuranceCompany([party("FORSAKRINGSBOLAG", "PERSON")])).toBe(true);
    expect(hasInsuranceCompany([party("FORSAKRINGSBOLAG", "INSURANCE_COMPANY")])).toBe(true);
    expect(hasInsuranceCompany([party("FORSAKRINGSBOLAG")])).toBe(true);
    expect(hasInsuranceCompany([party("FORSAKRINGSBOLAG", null)])).toBe(true);
  });

  it("falskt för kontakttypen Försäkringsbolag i en annan roll", () => {
    for (const role of ["OVRIG", "OMBUD", "MOTPART", "MOTPARTSOMBUD"] as const) {
      expect(hasInsuranceCompany([party(role, "INSURANCE_COMPANY")])).toBe(false);
    }
  });

  it("falskt utan kontakter", () => {
    expect(hasInsuranceCompany([])).toBe(false);
  });
});

describe("findInsuranceCompany (#1518, #1961)", () => {
  const client = party("KLIENT", "PERSON");
  const first = party("FORSAKRINGSBOLAG", "COMPANY");
  const second = party("FORSAKRINGSBOLAG", "INSURANCE_COMPANY");

  it("ger parten med anroparens egen kontaktform", () => {
    expect(findInsuranceCompany([client, first])?.contact.name).toBe("FORSAKRINGSBOLAG COMPANY");
  });

  it("ger den första av flera med rollen Försäkringsbolag", () => {
    expect(findInsuranceCompany([client, first, second])).toBe(first);
    expect(findInsuranceCompany([second, first])).toBe(second);
  });

  it("hoppar över kontakttypen Försäkringsbolag i en annan roll", () => {
    expect(findInsuranceCompany([party("OVRIG", "INSURANCE_COMPANY"), first])).toBe(first);
  });

  it("ger undefined utan rollen Försäkringsbolag och för en tom lista", () => {
    expect(findInsuranceCompany([client, party("MOTPART", "INSURANCE_COMPANY")])).toBeUndefined();
    expect(findInsuranceCompany([])).toBeUndefined();
  });
});
