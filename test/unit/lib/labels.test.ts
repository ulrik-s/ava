import { describe, it, expect } from "vitest";
import { matterRoleLabels, matterRoles, contactTypeLabels, contactTypes } from "@/lib/labels";

describe("matterRoleLabels", () => {
  it("använder 'Klient' (inte 'Huvudman') som label för KLIENT", () => {
    expect(matterRoleLabels.KLIENT).toBe("Klient");
  });

  it("har ingen kvarvarande HUVUDMAN-nyckel", () => {
    // Locked down after HUVUDMAN → KLIENT rename. Om någon återinför
    // HUVUDMAN skall det här testet säga ifrån.
    expect(matterRoleLabels).not.toHaveProperty("HUVUDMAN");
  });

  it("innehåller alla vedertagna rollvärden", () => {
    expect(matterRoleLabels.MOTPART).toBe("Motpart");
    expect(matterRoleLabels.MOTPARTSOMBUD).toBe("Motpartsombud");
    expect(matterRoleLabels.AKLAGARE).toBe("Åklagare");
    expect(matterRoleLabels.DOMSTOL).toBe("Domstol");
    expect(matterRoleLabels.VITTNE).toBe("Vittne");
    expect(matterRoleLabels.OMBUD).toBe("Ombud");
    expect(matterRoleLabels.OVRIG).toBe("Övrig");
  });
});

describe("matterRoles (dropdown-lista)", () => {
  it("har KLIENT som första valbara roll", () => {
    expect(matterRoles[0]).toEqual({ value: "KLIENT", label: "Klient" });
  });

  it("innehåller inget objekt med value === HUVUDMAN", () => {
    // Cast to string — TS vet redan att "HUVUDMAN" inte finns (typen har
    // skalbort det), men testet dokumenterar invarianten mot runtime-data.
    expect(matterRoles.some((r) => (r.value as string) === "HUVUDMAN")).toBe(false);
  });

  it("listan matchar labels-mappen i både value och label", () => {
    for (const { value, label } of matterRoles) {
      expect(matterRoleLabels[value]).toBe(label);
    }
  });
});

describe("contactTypeLabels", () => {
  it("innehåller PERSON, COMPANY och LAW_FIRM", () => {
    expect(contactTypeLabels.PERSON).toBe("Person");
    expect(contactTypeLabels.COMPANY).toBe("Företag");
    expect(contactTypeLabels.LAW_FIRM).toBe("Advokatbyrå");
  });

  it("contactTypes-listan matchar labels-mappen", () => {
    for (const { value, label } of contactTypes) {
      expect(contactTypeLabels[value]).toBe(label);
    }
  });
});
