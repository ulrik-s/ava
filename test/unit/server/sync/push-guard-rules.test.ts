/**
 * Reglerna i `push-guard` (#1242) utan databas — gränsfallen.
 */
import { describe, expect, it } from "vitest-compat";
import { checkProcedureOwned, checkScope, comparable, type OrgOf } from "@/lib/server/sync/push-guard";
import { PROCEDURE_OWNED_REASON } from "@/lib/shared/sync/procedure-owned";

const byColumn: OrgOf = async (row) => (typeof row.organizationId === "string" ? row.organizationId : undefined);

describe("checkScope", () => {
  it("konfliktkontroller har ingen byrå i schemat — avgränsas inte", async () => {
    expect(await checkScope(byColumn, "A", "conflictCheck", null, { id: "x" })).toBeNull();
  });

  it("delete av egen rad: bara den befintliga raden prövas", async () => {
    expect(await checkScope(byColumn, "A", "contact", { id: "c", organizationId: "A" }, null)).toBeNull();
  });

  it("en befintlig rad utan byrå räknas inte som den egna", async () => {
    expect(await checkScope(byColumn, "A", "contact", { id: "c" }, { name: "x" })).toEqual({ reason: "annan byrå" });
  });

  it("update som bara skickar ändrade fält: byrån tas från den befintliga raden", async () => {
    expect(await checkScope(byColumn, "A", "contact", { id: "c", organizationId: "A" }, { name: "Nytt" })).toBeNull();
  });
});

describe("checkProcedureOwned", () => {
  it("procedurägd entitet utan befintlig rad → avvisad, ingen serverrad", () => {
    expect(checkProcedureOwned("invoice", null)).toEqual({ reason: PROCEDURE_OWNED_REASON });
  });

  it("procedurägd entitet med befintlig rad → avvisad med serverns rad", () => {
    expect(checkProcedureOwned("timeEntry", { id: "t", minutes: 60 })).toEqual({ reason: PROCEDURE_OWNED_REASON, current: { id: "t", minutes: 60 } });
  });

  it("ren data (kontakter) berörs inte", () => {
    expect(checkProcedureOwned("contact", { id: "c" })).toBeNull();
  });
});

describe("comparable", () => {
  it("samma tidpunkt som Date och ISO-sträng jämförs lika; saknat blir null", () => {
    expect(comparable(new Date("2026-06-01T09:00:00Z"))).toBe(comparable("2026-06-01T09:00:00.000Z"));
    expect(comparable(undefined)).toBeNull();
    expect(comparable("text")).toBe("text");
  });
});
