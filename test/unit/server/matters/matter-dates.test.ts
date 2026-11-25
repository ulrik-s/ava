/**
 * Ärendets datumfält (#2098): `keepMatterActive` sätter datumet för Behåll som
 * aktivt till anropets tid, och datumhjälparna som flyttade ur matter-routern
 * fungerar som förut.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { applyOptionalDate, keepMatterActive, toDateOrNull } from "@/lib/server/matters/matter-dates";
import { asId } from "@/lib/shared/schemas/ids";

const MATTER = asId<"MatterId">("m-1");
const AT = Date.UTC(2026, 10, 20, 9, 30);

function setup(queued?: { mutationId: string; at: number }) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }, { id: "org-2", name: "Y" }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "LAWYER" }],
    matters: [
      { id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Tvist", status: "CLOSED", createdAt: new Date() },
      { id: "m-9", organizationId: "org-2", matterNumber: "2026-0009", title: "Annan byrå", status: "ACTIVE", createdAt: new Date() },
    ],
  }, async () => { /* writable */ });
  const ctx = buildContext({
    dataStore: ds, ports: noopPorts,
    principal: { id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "LAWYER", organizationId: asId<"OrganizationId">("org-1") },
  });
  // orgId sätts annars av orgProcedure-middleware:n.
  return { ...ctx, orgId: asId<"OrganizationId">("org-1"), ...(queued ? { queued } : {}) };
}

describe("keepMatterActive (#2098)", () => {
  it("i ett köat anrop blir datumet anropets tid", async () => {
    const res = await keepMatterActive(setup({ mutationId: "01928f3a-1b2c-7d4e-8f00-112233445566", at: AT }), MATTER);
    expect(new Date(String(res.keptActiveAt)).getTime()).toBe(AT);
  });

  it("utan köat anrop blir datumet nu", async () => {
    const before = Math.floor(Date.now() / 1000) * 1000; // lagras i hela sekunder
    const res = await keepMatterActive(setup(), MATTER);
    const at = new Date(String(res.keptActiveAt)).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("status och ärendets andra fält ändras inte — inte heller i ett stängt ärende", async () => {
    const res = await keepMatterActive(setup(), MATTER);
    expect(res).toMatchObject({ status: "CLOSED", title: "Tvist", matterNumber: "2026-0001" });
  });

  it("ett ärende i en annan byrå ger NOT_FOUND", async () => {
    await expect(keepMatterActive(setup(), asId<"MatterId">("m-9"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ärendets datumhjälpare", () => {
  it("toDateOrNull: utelämnad rör inte, tom blir null, annars ett datum", () => {
    expect(toDateOrNull(undefined)).toBeUndefined();
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull("")).toBeNull();
    expect(toDateOrNull("2026-03-01")).toEqual(new Date("2026-03-01"));
  });

  it("applyOptionalDate sätter fältet bara när det skickades med", () => {
    const data: Record<string, unknown> = {};
    applyOptionalDate(data, "a", undefined);
    applyOptionalDate(data, "b", null);
    applyOptionalDate(data, "c", "2026-03-01");
    expect(data).toEqual({ b: null, c: new Date("2026-03-01") });
  });
});
