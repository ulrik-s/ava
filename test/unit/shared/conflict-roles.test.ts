/**
 * Jävskontrollens rollregler (#1354): en träff är en konflikt när samma person
 * står på olika sidor — klient här och motpart/motpartsombud där, eller
 * tvärtom. Samma sida och neutrala roller är inga konflikter.
 */
import { describe, expect, it } from "vitest-compat";
import { CONFLICT_SIDE, isCheckedRole, isConflictingRole, mayReviewConflicts } from "@/lib/shared/conflict-roles";
import { matterRoleSchema, type MatterRole, type UserRole } from "@/lib/shared/schemas/enums";

/** [roll här, roll i ett annat ärende, konflikt?] */
const TABLE: ReadonlyArray<readonly [MatterRole, MatterRole, boolean]> = [
  // Klient här ↔ motsidan där: den klassiska konflikten.
  ["KLIENT", "MOTPART", true],
  ["KLIENT", "MOTPARTSOMBUD", true],
  // Motsidan här ↔ klient där (en befintlig eller tidigare klient blir motpart).
  ["MOTPART", "KLIENT", true],
  ["MOTPARTSOMBUD", "KLIENT", true],
  // Samma sida: återkommande klient, samma motpart i flera ärenden.
  ["KLIENT", "KLIENT", false],
  ["MOTPART", "MOTPART", false],
  ["MOTPART", "MOTPARTSOMBUD", false],
  ["MOTPARTSOMBUD", "MOTPARTSOMBUD", false],
  // Neutrala roller är inte parter.
  ["KLIENT", "VITTNE", false],
  ["KLIENT", "DOMSTOL", false],
  ["KLIENT", "AKLAGARE", false],
  ["KLIENT", "FORSAKRINGSBOLAG", false],
  ["KLIENT", "OMBUD", false],
  ["KLIENT", "OVRIG", false],
  ["MOTPART", "VITTNE", false],
  ["VITTNE", "KLIENT", false],
  ["DOMSTOL", "MOTPART", false],
  ["OVRIG", "OVRIG", false],
];

const ALL_ROLES: readonly MatterRole[] = matterRoleSchema.options;

describe("isConflictingRole", () => {
  for (const [here, elsewhere, expected] of TABLE) {
    it(`${here} här, ${elsewhere} där → konflikt: ${expected}`, () => {
      expect(isConflictingRole(here, elsewhere)).toBe(expected);
    });
  }

  it("symmetrisk för alla roller", () => {
    for (const a of ALL_ROLES) for (const b of ALL_ROLES) expect(isConflictingRole(a, b)).toBe(isConflictingRole(b, a));
  });

  it("varje roll har en sida", () => {
    expect(Object.keys(CONFLICT_SIDE).sort()).toEqual([...ALL_ROLES].sort());
  });
});

describe("isCheckedRole", () => {
  const CHECKED: ReadonlyArray<readonly [MatterRole, boolean]> = [
    ["KLIENT", true], ["MOTPART", true], ["MOTPARTSOMBUD", true],
    ["VITTNE", false], ["DOMSTOL", false], ["AKLAGARE", false], ["FORSAKRINGSBOLAG", false], ["OMBUD", false], ["OVRIG", false],
  ];
  for (const [role, expected] of CHECKED) {
    it(`${role} kontrolleras: ${expected}`, () => {
      expect(isCheckedRole(role)).toBe(expected);
    });
  }
});

describe("mayReviewConflicts", () => {
  const REVIEWERS: ReadonlyArray<readonly [UserRole, boolean]> = [["ADMIN", true], ["LAWYER", true], ["ASSISTANT", false]];
  for (const [role, expected] of REVIEWERS) {
    it(`${role} får bedöma: ${expected}`, () => {
      expect(mayReviewConflicts(role)).toBe(expected);
    });
  }
});
