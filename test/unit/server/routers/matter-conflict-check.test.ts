/**
 * Ärendets jävskontroll (#1246).
 *
 * Nya ärenden kontrolleras mot byråns alla andra ärenden när de skapas.
 * Klientens optimistiska körning (offline, `provisional`) avgör ingenting utan
 * lämnar kontrollen som väntande. Servern kör om anropet och avgör.
 */

import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { checkMatterConflicts } from "@/lib/server/conflict/matter-conflict-check";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = "org-1";
const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">(ORG),
};
const OLD = asId<"MatterId">("019a0000-0000-7000-8000-000000000001");
const NEW = asId<"MatterId">("019a0000-0000-7000-8000-000000000002");
const KLIENT = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c1");
const OTHER = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c2");
const QUEUED = { mutationId: "019a0000-0000-7000-8000-00000000aaaa", at: Date.UTC(2026, 8, 30, 10) };

/** Byrån: `KLIENT` är motpart i ett befintligt ärende; `OTHER` förekommer ingenstans. */
function setup() {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "Byrån" }],
    users: [{ id: "u-1", organizationId: ORG, email: "a@x", name: "Anna", role: "ADMIN" }],
    matters: [{ id: OLD, organizationId: ORG, matterNumber: "2026-0001", title: "Tvist", status: "ACTIVE", createdAt: new Date() }],
    contacts: [
      { id: KLIENT, organizationId: ORG, name: "Bo Berg", contactType: "PERSON", personalNumber: "19800101-1234" },
      { id: OTHER, organizationId: ORG, name: "Cecilia Ek", contactType: "PERSON" },
    ],
    matterContacts: [{ id: "019a0000-0000-7000-8000-0000000000d1", matterId: OLD, contactId: KLIENT, role: "MOTPART" }],
    conflictChecks: [],
  }, async () => { /* skrivbart lager */ });
  const ctx = buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL });
  return { ctx, caller: appRouter.createCaller(ctx) };
}

describe("matter.create — jävskontrollen", () => {
  it("klienten är motpart i ett annat ärende → träffar att bedöma, och kontrollen loggas", async () => {
    const { caller, ctx } = setup();
    const matter = await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    expect(matter).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
    expect(matter.conflictCheckedAt).toBeInstanceOf(Date);
    const { checks } = await ctx.repos.conflictChecks.listHistory(1, 10);
    expect(checks.map((c) => c.searchTerm)).toEqual(["Bo Berg 19800101-1234"]);
  });

  it("klienten förekommer inte → inga träffar; ärendets egen klientkoppling räknas inte", async () => {
    const { caller } = setup();
    expect(await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER }))
      .toMatchObject({ conflictCheckStatus: "CLEAR", conflictCheckHits: 0 });
  });

  it("utan klient finns inget att kontrollera → väntar", async () => {
    const { caller } = setup();
    expect(await caller.matter.create({ title: "Nytt" })).toMatchObject({ conflictCheckStatus: "PENDING", conflictCheckHits: null });
  });

  it("klientens optimistiska körning (offline) avgör inget: väntar, och ingen kontroll loggas", async () => {
    const { ctx } = setup();
    const offline = appRouter.createCaller({ ...ctx, queued: QUEUED, provisional: true });
    expect(await offline.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT })).toMatchObject({ conflictCheckStatus: "PENDING" });
    expect((await ctx.repos.conflictChecks.listHistory(1, 10)).total).toBe(0);
  });

  it("serverns körning av samma köade anrop avgör — med kontrollens id härlett ur anropet", async () => {
    const { ctx } = setup();
    const server = appRouter.createCaller({ ...ctx, queued: QUEUED });
    expect(await server.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT })).toMatchObject({ conflictCheckStatus: "HITS" });
    const { checks } = await ctx.repos.conflictChecks.listHistory(1, 10);
    expect(checks).toHaveLength(1);
  });
});

describe("matter.checkConflicts — kör om", () => {
  it("klienten lades till efter att ärendet skapades → kontrollen körs för den", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    await caller.matter.addContact({ matterId: NEW, contactId: KLIENT, role: "KLIENT" });
    expect(await caller.matter.checkConflicts({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
  });

  it("fortfarande utan klient → väntar", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    expect(await caller.matter.checkConflicts({ id: NEW })).toMatchObject({ conflictCheckStatus: "PENDING" });
  });

  it("okänt ärende → NOT_FOUND", async () => {
    const { caller } = setup();
    await expect(caller.matter.checkConflicts({ id: NEW })).rejects.toThrow(/finns inte/);
  });
});

describe("matter.markConflictsReviewed", () => {
  it("träffarna bedömda → Bedömd", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    expect(await caller.matter.markConflictsReviewed({ id: NEW })).toMatchObject({ conflictCheckStatus: "REVIEWED" });
  });

  it("utan träffar finns inget att bedöma", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    await expect(caller.matter.markConflictsReviewed({ id: NEW })).rejects.toThrow(/inga träffar/);
  });

  it("okänt ärende → NOT_FOUND", async () => {
    const { caller } = setup();
    await expect(caller.matter.markConflictsReviewed({ id: NEW })).rejects.toThrow(/finns inte/);
  });
});

describe("checkMatterConflicts", () => {
  it("en klient som inte finns (t.ex. raderad) → väntar", async () => {
    const { ctx } = setup();
    const missing = asId<"ContactId">("019a0000-0000-7000-8000-0000000000ff");
    expect(await checkMatterConflicts({ ...ctx, user: PRINCIPAL }, NEW, missing)).toMatchObject({ conflictCheckStatus: "PENDING" });
  });

  it("klient med bara organisationsnummer söks på det", async () => {
    const { ctx } = setup();
    await ctx.repos.contacts.create({ id: asId<"ContactId">("019a0000-0000-7000-8000-0000000000c3"), organizationId: asId<"OrganizationId">(ORG), name: "Berg AB", contactType: "COMPANY", orgNumber: "556000-1111" });
    await checkMatterConflicts({ ...ctx, user: PRINCIPAL }, NEW, asId<"ContactId">("019a0000-0000-7000-8000-0000000000c3"));
    const { checks } = await ctx.repos.conflictChecks.listHistory(1, 10);
    expect(checks[0]?.searchTerm).toBe("Berg AB 556000-1111");
  });
});
