/**
 * Skapa-anropen för kalender och uppgifter håller sina referenser inom byrån
 * (#1452) — samma regel som radkön har för `refs` (`row-push-policy.ts`).
 * Ett ärende- eller användar-id ur en annan byrå ger NOT_FOUND och ingen rad.
 */

import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { requireRefsInOrg } from "@/lib/server/auth/org-scope";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-1");
const PRINCIPAL: Principal = { id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "LAWYER", organizationId: ORG };
const START = new Date("2026-10-20T09:00:00Z");

function setup() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå" }, { id: "org-2", name: "Annan" }],
    matters: [
      { id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Egen", status: "ACTIVE", createdAt: new Date() },
      { id: "m-x", organizationId: "org-2", matterNumber: "2026-0002", title: "Främmande", status: "ACTIVE", createdAt: new Date() },
    ],
    users: [
      { id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "LAWYER" },
      { id: "u-2", organizationId: "org-1", email: "b@x", name: "Bo", role: "LAWYER" },
      { id: "u-x", organizationId: "org-2", email: "x@y", name: "Xena", role: "ADMIN" },
    ],
    calendarEvents: [],
    tasks: [],
  }, async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
  return { ds, caller };
}

const userId = (id: string) => asId<"UserId">(id);
const matterId = (id: string) => asId<"MatterId">(id);

describe("calendar.create — referenser inom byrån (#1452)", () => {
  it("nekar ett ärende i en annan byrå", async () => {
    const { caller } = setup();
    await expect(caller.calendar.create({ title: "Möte", startAt: START, matterId: matterId("m-x") }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await caller.calendar.list()).toHaveLength(0);
  });

  it("nekar en användare i en annan byrå", async () => {
    const { caller } = setup();
    await expect(caller.calendar.create({ title: "Möte", startAt: START, userId: userId("u-x") }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("nekar en inbjuden användare i en annan byrå", async () => {
    const { caller } = setup();
    await expect(caller.calendar.create({ title: "Möte", startAt: START, inviteeUserIds: [userId("u-2"), userId("u-x")] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("tillåter eget ärende, kollega och inbjudna i byrån", async () => {
    const { caller } = setup();
    const ev = await caller.calendar.create({
      title: "Förhandling", startAt: START, matterId: matterId("m-1"), inviteeUserIds: [userId("u-2")],
    });
    expect(ev).toMatchObject({ title: "Förhandling", matterId: "m-1", userId: "u-1", organizationId: "org-1" });
  });
});

describe("task.create — referenser inom byrån (#1452)", () => {
  it("nekar ett ärende i en annan byrå", async () => {
    const { caller } = setup();
    await expect(caller.task.create({ title: "Frist", matterId: matterId("m-x") }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("nekar en användare i en annan byrå", async () => {
    const { caller } = setup();
    await expect(caller.task.create({ title: "Frist", userId: userId("u-x") }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("tillåter eget ärende och en kollega i byrån", async () => {
    const { caller } = setup();
    const task = await caller.task.create({ title: "Frist", matterId: matterId("m-1"), userId: userId("u-2") });
    expect(task).toMatchObject({ title: "Frist", matterId: "m-1", userId: "u-2", organizationId: "org-1" });
  });
});

describe("requireRefsInOrg", () => {
  it("godtar tomma referenser utan uppslag", async () => {
    const { ds } = setup();
    const repos = buildInMemoryRepositories(ds);
    await expect(requireRefsInOrg({ repos, orgId: ORG }, {})).resolves.toBeUndefined();
    await expect(requireRefsInOrg({ repos, orgId: ORG }, { matterId: null, userIds: [undefined, null] })).resolves.toBeUndefined();
  });
});
