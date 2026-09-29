/**
 * Reglerna i `push-guard` (#1242) utan databas — gränsfallen.
 */
import { describe, expect, it } from "vitest-compat";
import { checkLocked, checkScope, type OrgOf } from "@/lib/server/sync/push-guard";

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

describe("checkLocked", () => {
  const locked = { id: "t", frozenAt: new Date("2026-06-30T00:00:00Z"), minutes: 60, date: new Date("2026-06-01T09:00:00Z") };

  it("samma tidpunkt som ISO-sträng är ingen ändring", () => {
    expect(checkLocked("timeEntry", locked, { ...locked, date: "2026-06-01T09:00:00.000Z" })).toBeNull();
  });

  it("fält som inte skickas räknas inte som ändrade", () => {
    expect(checkLocked("timeEntry", locked, { id: "t" })).toBeNull();
  });

  it("fakturerat utan frysning (invoiceId) är också låst", () => {
    expect(checkLocked("expense", { id: "e", invoiceId: "inv", amount: 100 }, { amount: 200 })).toMatchObject({ reason: "låst" });
  });

  it("andra entiteter berörs inte", () => {
    expect(checkLocked("contact", { id: "c", frozenAt: new Date() }, null)).toBeNull();
  });

  it("ny rad (ingen befintlig) är aldrig låst", () => {
    expect(checkLocked("timeEntry", null, { minutes: 5 })).toBeNull();
  });
});
