/**
 * `seesAllTime` (#2114): bara Admin ser allas tider på Tidregistrering.
 * Valet i Rapporters fält Advokat (#2116): `subjectChoices`, `resolveSubject`.
 */
import { describe, expect, it } from "vitest-compat";
import { FIRM_CHOICE, resolveSubject, seesAllTime, subjectChoices, subjectValue } from "@/lib/shared/report-subject";
import { USER_ROLE_LABELS, type UserRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";

describe("seesAllTime", () => {
  it("bara ADMIN ser allas tider, för varje roll i USER_ROLE_LABELS", () => {
    const roles = Object.keys(USER_ROLE_LABELS) as UserRole[];
    expect(Object.fromEntries(roles.map((r) => [r, seesAllTime(r)]))).toEqual({
      ADMIN: true, LAWYER: false, ASSISTANT: false,
    });
  });
});

const SELF = asId<"UserId">("u-self");
const OTHER = asId<"UserId">("u-other");
const USERS = [{ id: OTHER, name: "Bo" }, { id: SELF, name: "Anna" }];

describe("subjectChoices (#2116)", () => {
  it("den som inte ser allas tider har bara sig själv", () => {
    expect(subjectChoices(USERS, SELF, false)).toEqual([{ value: SELF, label: "Anna" }]);
  });

  it("utan användarlistan heter alternativet tomt tills den kommer", () => {
    expect(subjectChoices([], SELF, false)).toEqual([{ value: SELF, label: "" }]);
  });

  it("en Admin har Alla överst och sedan alla användare", () => {
    expect(subjectChoices(USERS, SELF, true)).toEqual([
      { value: FIRM_CHOICE, label: "Alla" }, { value: OTHER, label: "Bo" }, { value: SELF, label: "Anna" },
    ]);
  });
});

describe("resolveSubject (#2116)", () => {
  it("den som inte ser allas tider får alltid sig själv, också med ett annat val", () => {
    expect(resolveSubject(OTHER, SELF, false)).toEqual({ kind: "lawyer", userId: SELF });
    expect(resolveSubject(FIRM_CHOICE, SELF, false)).toEqual({ kind: "lawyer", userId: SELF });
    expect(resolveSubject(null, SELF, false)).toEqual({ kind: "lawyer", userId: SELF });
  });

  it("en Admin får sitt val, och utan val sig själv", () => {
    expect(resolveSubject(null, SELF, true)).toEqual({ kind: "lawyer", userId: SELF });
    expect(resolveSubject(OTHER, SELF, true)).toEqual({ kind: "lawyer", userId: OTHER });
    expect(resolveSubject(FIRM_CHOICE, SELF, true)).toEqual({ kind: "firm" });
  });
});

describe("subjectValue (#2116)", () => {
  it("hela byrån är Alla, en jurist sitt id", () => {
    expect(subjectValue({ kind: "firm" })).toBe(FIRM_CHOICE);
    expect(subjectValue({ kind: "lawyer", userId: SELF })).toBe(SELF);
  });
});
