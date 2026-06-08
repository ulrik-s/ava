/**
 * Regressionsskydd: deep-link `?date=YYYY-MM-DD` (från matter-detalj
 * "Gå till kalendern") måste välja ALLA org-users i picker:n så event
 * av andra ägare än current-user faktiskt syns.
 *
 * Bug: tidigare valdes bara current-user → events av kollegor dolda →
 * "kalendern är tom" trots att event:t existerar.
 */

import { describe, it, expect } from "vitest-compat";
import { resolveSelectedUsers } from "@/lib/client/calendar/select-users";

const ALL = ["u-anna", "u-bjorn", "u-eva"];

describe("resolveSelectedUsers", () => {
  it("utan deep-link och utan sparat val: bara current-user", () => {
    expect(resolveSelectedUsers({ stored: [], currentUserId: "u-anna", orgUserIds: ALL, hasDateParam: false }))
      .toEqual(["u-anna"]);
  });

  it("med deep-link (?date=): ALLA org-users väljs", () => {
    expect(resolveSelectedUsers({ stored: [], currentUserId: "u-anna", orgUserIds: ALL, hasDateParam: true }))
      .toEqual(ALL);
  });

  it("deep-link vinner över sparat val", () => {
    expect(resolveSelectedUsers({ stored: ["u-bjorn"], currentUserId: "u-anna", orgUserIds: ALL, hasDateParam: true }))
      .toEqual(ALL);
  });

  it("utan deep-link men med sparat val: använder sparat", () => {
    expect(resolveSelectedUsers({ stored: ["u-eva"], currentUserId: "u-anna", orgUserIds: ALL, hasDateParam: false }))
      .toEqual(["u-eva"]);
  });

  it("deep-link men org-users ej laddade än → faller tillbaka (inte tom)", () => {
    expect(resolveSelectedUsers({ stored: [], currentUserId: "u-anna", orgUserIds: [], hasDateParam: true }))
      .toEqual(["u-anna"]);
  });

  it("inget laddat alls → tom array", () => {
    expect(resolveSelectedUsers({ stored: [], currentUserId: null, orgUserIds: [], hasDateParam: false }))
      .toEqual([]);
  });
});
