/**
 * Enhetstest för ärendeuppgifternas sparindata i "Ändra ärende"-dialogen (#1565).
 */

import { describe, it, expect } from "vitest-compat";
import {
  canSaveMatterDetails, matterDetailsFromMatter, matterDetailsInput, type MatterDetailsValues,
} from "@/app/matters/[id]/_matter-edit-input";

const VALUES: MatterDetailsValues = {
  title: "T", matterType: "Bodelning", courtCaseNumber: "T 1-26", insuranceReference: "SK-1", description: "B",
};
const CTX = { matterTypes: ["Bodelning"], showInsuranceReference: true };

describe("matterDetailsFromMatter", () => {
  it("tar ärendets värden och gör saknade till tomma", () => {
    expect(matterDetailsFromMatter({ title: "T", courtCaseNumber: "", insuranceReference: "" }))
      .toEqual({ title: "T", matterType: "", courtCaseNumber: "", insuranceReference: "", description: "" });
    expect(matterDetailsFromMatter({ ...VALUES })).toEqual(VALUES);
  });
});

describe("matterDetailsInput", () => {
  it("skickar alla uppgifter när typen är vald och referensen visas", () => {
    expect(matterDetailsInput(VALUES, CTX)).toEqual({
      title: "T", matterType: "Bodelning", courtCaseNumber: "T 1-26", insuranceReference: "SK-1", description: "B",
    });
  });

  it("tomma fält: målnummer och referens null, beskrivning tom sträng", () => {
    const input = matterDetailsInput({ ...VALUES, courtCaseNumber: "", insuranceReference: "", description: "" }, CTX);
    expect(input).toEqual(expect.objectContaining({ courtCaseNumber: null, insuranceReference: null, description: "" }));
  });

  it("utelämnar ärendetypen utan val ur byråns lista", () => {
    expect(matterDetailsInput({ ...VALUES, matterType: "" }, CTX)).not.toHaveProperty("matterType");
    expect(matterDetailsInput({ ...VALUES, matterType: "Fritext" }, CTX)).not.toHaveProperty("matterType");
    expect(matterDetailsInput(VALUES, { ...CTX, matterTypes: [] })).not.toHaveProperty("matterType");
  });

  it("utelämnar försäkringsreferensen när den inte visas", () => {
    expect(matterDetailsInput(VALUES, { ...CTX, showInsuranceReference: false })).not.toHaveProperty("insuranceReference");
  });
});

describe("canSaveMatterDetails", () => {
  it("kräver en titel som inte bara är blanksteg", () => {
    expect(canSaveMatterDetails(VALUES)).toBe(true);
    expect(canSaveMatterDetails({ ...VALUES, title: "" })).toBe(false);
    expect(canSaveMatterDetails({ ...VALUES, title: "   " })).toBe(false);
  });
});
