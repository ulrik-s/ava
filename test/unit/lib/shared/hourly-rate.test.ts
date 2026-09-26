/**
 * `hourly-rate` — vilket timpris en tidspost får (#1195, #1199, #1206).
 * Beloppen är i öre/h. Varje timbaserad kategori ärvs byrå → jurist → ärende
 * (mest specifik vinner); saknas kategorin överallt gäller timarvodet genom
 * samma kedja, annars 0.
 */

import { describe, it, expect } from "vitest-compat";
import {
  inheritedHourlyRate, isHourlyKind, isTidsspillanKind, resolveHourlyRate,
} from "@/lib/shared/hourly-rate";
import { HOURLY_TIME_ENTRY_KINDS, type HourlyTimeEntryKind } from "@/lib/shared/schemas/enums";
import { hourlyRatesSchema } from "@/lib/shared/schemas/hourly-rates";

describe("isTidsspillanKind", () => {
  it("båda tidsspillan-kategorierna, inget annat", () => {
    expect(isTidsspillanKind("TIDSSPILLAN")).toBe(true);
    expect(isTidsspillanKind("TIDSSPILLAN_OVRIG_TID")).toBe(true);
    expect(isTidsspillanKind("ARBETE")).toBe(false);
    expect(isTidsspillanKind("ADVOKATBEREDSKAP")).toBe(false);
    expect(isTidsspillanKind(null)).toBe(false);
    expect(isTidsspillanKind(undefined)).toBe(false);
  });
});

describe("isHourlyKind", () => {
  it("de fyra timbaserade kategorierna — beredskap ersätts per dag", () => {
    for (const kind of HOURLY_TIME_ENTRY_KINDS) expect(isHourlyKind(kind)).toBe(true);
    expect(isHourlyKind("ADVOKATBEREDSKAP")).toBe(false);
  });
});

describe("hourlyRatesSchema", () => {
  it("tar emot en delmängd av kategorierna i öre", () => {
    expect(hourlyRatesSchema.parse({ ARBETE: 250_000, TIDSSPILLAN: 148_700 })).toEqual({ ARBETE: 250_000, TIDSSPILLAN: 148_700 });
    expect(hourlyRatesSchema.parse({})).toEqual({});
  });

  it("avvisar okänd kategori, beredskap, negativt pris och decimaler", () => {
    expect(hourlyRatesSchema.safeParse({ ADVOKATBEREDSKAP: 1 }).success).toBe(false);
    expect(hourlyRatesSchema.safeParse({ ARBETE: -1 }).success).toBe(false);
    expect(hourlyRatesSchema.safeParse({ ARBETE: 1.5 }).success).toBe(false);
  });
});

describe("resolveHourlyRate — samma arv för varje timbaserad kategori", () => {
  it.each([...HOURLY_TIME_ENTRY_KINDS])("%s: ärende → jurist → byrå → timarvodet → 0", (kind: HourlyTimeEntryKind) => {
    const only = (ore: number) => ({ [kind]: ore });
    expect(resolveHourlyRate(kind, { matter: only(300_000), user: only(200_000), org: only(100_000) })).toBe(300_000);
    expect(resolveHourlyRate(kind, { matter: {}, user: only(200_000), org: only(100_000) })).toBe(200_000);
    expect(resolveHourlyRate(kind, { matter: null, user: undefined, org: only(100_000) })).toBe(100_000);
    expect(resolveHourlyRate(kind, {})).toBe(0);
  });

  it("en kategoris pris på en lägre nivå vinner över timarvodet på en högre", () => {
    // Byrån har ett tidsspillan-pris, juristen bara ett eget timarvode.
    const levels = { user: { ARBETE: 300_000 }, org: { ARBETE: 250_000, TIDSSPILLAN: 148_700 } };
    expect(resolveHourlyRate("TIDSSPILLAN", levels)).toBe(148_700);
    expect(resolveHourlyRate("ARBETE", levels)).toBe(300_000);
  });

  it("saknas kategorin överallt gäller timarvodet genom samma kedja", () => {
    const levels = { matter: { ARBETE: 400_000 }, user: { ARBETE: 300_000 }, org: { ARBETE: 250_000 } };
    expect(resolveHourlyRate("TIDSSPILLAN_OVRIG_TID", levels)).toBe(400_000);
    expect(resolveHourlyRate("ARBETE_OBEKVAM_TID", { org: { ARBETE: 250_000 } })).toBe(250_000);
  });

  it("0 är ett satt pris (pro bono), inte ett saknat", () => {
    expect(resolveHourlyRate("ARBETE", { matter: { ARBETE: 0 }, org: { ARBETE: 250_000 } })).toBe(0);
  });
});

describe("inheritedHourlyRate — placeholderns 'ärvs: …'", () => {
  it("nivåns eget pris för kategorin räknas inte, dess timarvode gör det", () => {
    // Juristen har eget timarvode men ingen tidsspillan; byrån saknar tidsspillan.
    const own = { ARBETE: 300_000, TIDSSPILLAN: 999 };
    expect(inheritedHourlyRate("TIDSSPILLAN", own, [{ ARBETE: 250_000 }])).toBe(300_000);
    // Timarvodet självt ärvs från nivån ovanför.
    expect(inheritedHourlyRate("ARBETE", own, [{ ARBETE: 250_000 }])).toBe(250_000);
  });

  it("föräldrarnas kategoripris går före nivåns timarvode", () => {
    expect(inheritedHourlyRate("TIDSSPILLAN", { ARBETE: 300_000 }, [undefined, { TIDSSPILLAN: 148_700 }])).toBe(148_700);
  });

  it("inget att ärva → undefined", () => {
    expect(inheritedHourlyRate("ARBETE", { ARBETE: 1 }, [])).toBeUndefined();
    expect(inheritedHourlyRate("TIDSSPILLAN", {}, [null])).toBeUndefined();
  });
});
