/**
 * Enhetstest för formulärhjälparna i "Nytt ärende" (`_matter-form.ts`).
 */
import { describe, it, expect } from "vitest-compat";
import { EMPTY_MATTER_FORM, matterCreateArgs, withPickedClient } from "@/app/matters/_matter-form";

describe("withPickedClient (#1644)", () => {
  const anna = { id: "c-anna", name: "Anna Karlsson" };

  it("tom titel får klientens namn", () => {
    expect(withPickedClient(EMPTY_MATTER_FORM, anna)).toEqual({ ...EMPTY_MATTER_FORM, klientId: "c-anna", title: "Anna Karlsson" });
  });

  it("titel med bara mellanslag räknas som tom", () => {
    expect(withPickedClient({ ...EMPTY_MATTER_FORM, title: "  " }, anna).title).toBe("Anna Karlsson");
  });

  it("ifylld titel behålls", () => {
    expect(withPickedClient({ ...EMPTY_MATTER_FORM, title: "Bodelning" }, anna)).toEqual({ ...EMPTY_MATTER_FORM, klientId: "c-anna", title: "Bodelning" });
  });
});

describe("matterCreateArgs", () => {
  it("utelämnar tomma fält och trimmar målnumret", () => {
    expect(matterCreateArgs({ ...EMPTY_MATTER_FORM, title: "T", courtCaseNumber: " T 1-26 " }))
      .toEqual({ title: "T", description: undefined, matterType: undefined, klientId: undefined, responsibleLawyerId: undefined, courtCaseNumber: "T 1-26" });
  });
});
