/**
 * Befintliga ärenden byter till Offentligt uppdrag när admin sparar
 * ärendetyperna (#1640). Körs genom hela `appRouter` mot en riktig in-memory-
 * store: ett byte per ärende, en anteckning per byte med admin som författare,
 * bara i den egna byrån, och idempotent.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const ADMIN: Principal = {
  id: asId<"UserId">("u-admin"), email: "a@x", name: "Admin", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const PA = "Offentlig försvarare";

function matter(id: string, organizationId: string, matterType: string, paymentMethod: string) {
  return { id, organizationId, matterNumber: `AA2026-${id}`, title: id, status: "ACTIVE", responsibleLawyerId: "u-admin", createdAt: new Date(), matterType, paymentMethod };
}

function setup(publicAssignmentMatterTypes: string[] | null = null) {
  const ds = new DemoDataStore({
    organizations: [
      { id: "org-1", name: "X", matterTypes: [PA, "Bodelning"], publicAssignmentMatterTypes },
      { id: "org-2", name: "Y", matterTypes: [PA] },
    ],
    users: [
      { id: "u-admin", organizationId: "org-1", email: "a@x", name: "Admin", role: "ADMIN" },
      { id: "u-2", organizationId: "org-2", email: "b@x", name: "Bo", role: "ADMIN" },
    ],
    matters: [
      matter("m-pa", "org-1", PA, "PENDING"),
      matter("m-done", "org-1", PA, "OFFENTLIGT_UPPDRAG"),
      matter("m-other", "org-1", "Bodelning", "PRIVATE"),
      matter("m-org2", "org-2", PA, "PENDING"),
    ],
  }, async () => { /* skrivbar: noop write-back */ });
  const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: ADMIN }));
  const other = appRouter.createCaller(buildContext({
    dataStore: ds, ports: noopPorts,
    principal: { ...ADMIN, id: asId<"UserId">("u-2"), organizationId: asId<"OrganizationId">("org-2") },
  }));
  return { caller, other };
}
type Callers = ReturnType<typeof setup>;

async function methods({ caller, other }: Callers): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ["m-pa", "m-done", "m-other"]) out[id] = (await caller.matter.getById({ id: asId<"MatterId">(id) })).paymentMethod;
  out["m-org2"] = (await other.matter.getById({ id: asId<"MatterId">("m-org2") })).paymentMethod;
  return out;
}

async function notes({ caller }: Callers, id: string) {
  return caller.serviceNote.list({ matterId: asId<"MatterId">(id) });
}

const UNCHANGED = { "m-pa": "PENDING", "m-done": "OFFENTLIGT_UPPDRAG", "m-other": "PRIVATE", "m-org2": "PENDING" };

describe("organization.updateSettings byter befintliga ärenden (#1640)", () => {
  it("markerad typ: ärendet byter och får en anteckning av admin; andra sparningen ändrar inget", async () => {
    const c = setup();
    await c.caller.organization.updateSettings({ publicAssignmentMatterTypes: [PA] });
    expect(await methods(c)).toEqual({ ...UNCHANGED, "m-pa": "OFFENTLIGT_UPPDRAG" });
    const [note, ...rest] = await notes(c, "m-pa");
    expect(rest).toEqual([]);
    expect(note?.authorId).toBe("u-admin");
    expect(note?.text).toContain("Offentligt uppdrag");
    expect(await notes(c, "m-done")).toEqual([]);
    expect(await notes(c, "m-other")).toEqual([]);

    await c.caller.organization.updateSettings({ matterTypes: [PA, "Bodelning"], publicAssignmentMatterTypes: [PA] });
    expect(await notes(c, "m-pa")).toHaveLength(1);
  });

  it("ärendetyperna sparas med en redan satt markering: ärendena byter", async () => {
    const c = setup([PA]);
    await c.caller.organization.updateSettings({ matterTypes: [PA, "Bodelning"] });
    expect(await methods(c)).toEqual({ ...UNCHANGED, "m-pa": "OFFENTLIGT_UPPDRAG" });
  });

  it("urkryssning ändrar inga ärenden", async () => {
    const c = setup([PA]);
    await c.caller.organization.updateSettings({ publicAssignmentMatterTypes: [] });
    expect(await methods(c)).toEqual(UNCHANGED);
    expect(await notes(c, "m-pa")).toEqual([]);
  });

  it("andra inställningar ändrar inga ärenden", async () => {
    const c = setup([PA]);
    await c.caller.organization.updateSettings({ name: "Nytt namn" });
    expect(await methods(c)).toEqual(UNCHANGED);
  });

  it("ärendetyper utan satt markering ändrar inga ärenden", async () => {
    const c = setup();
    await c.caller.organization.updateSettings({ matterTypes: [PA] });
    expect(await methods(c)).toEqual(UNCHANGED);
  });
});
