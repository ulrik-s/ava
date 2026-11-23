/**
 * Integrationstest för interrogationRouter (#1855) — förhör i förordnandemål.
 * Kör mot riktig DemoDataStore via createCaller: byrån, reglerna för tider och
 * uppehåll, ordningen och mjuk borttagning. Den rena regelfunktionen prövas
 * för sig.
 */

import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { interrogationTimesProblem } from "@/lib/server/routers/interrogation";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = { id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1") };

const t = (hhmm: string): string => `2026-10-01T${hhmm}:00.000Z`;

function makeCaller(foreignInterrogation = false) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå" }, { id: "org-2", name: "Annan" }],
    matters: [
      { id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Brottmål", status: "ACTIVE", createdAt: new Date() },
      { id: "m-foreign", organizationId: "org-2", matterNumber: "2026-0002", title: "U", status: "ACTIVE", createdAt: new Date() },
    ],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    interrogations: foreignInterrogation
      ? [{ id: "i-foreign", organizationId: "org-2", matterId: "m-foreign", start: t("08:00"), end: t("09:00"), pauses: [] }]
      : [],
  }, async () => {});
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}

describe("interrogationTimesProblem (ren regel)", () => {
  it("godtar ett förhör utan och med uppehåll", () => {
    expect(interrogationTimesProblem({ start: t("08:00"), end: t("10:00"), pauses: [] })).toBeNull();
    expect(interrogationTimesProblem({
      start: t("08:00"), end: t("10:00"),
      pauses: [{ start: t("09:00"), end: t("09:30") }, { start: t("08:10"), end: t("08:20") }],
    })).toBeNull();
  });

  it("slutet måste vara efter början", () => {
    expect(interrogationTimesProblem({ start: t("10:00"), end: t("09:00"), pauses: [] })).toMatch(/sluta efter/);
    expect(interrogationTimesProblem({ start: t("10:00"), end: t("10:00"), pauses: [] })).toMatch(/sluta efter/);
  });

  it("uppehållet måste ligga inom förhöret och sluta efter att det börjat", () => {
    const base = { start: t("08:00"), end: t("10:00") };
    expect(interrogationTimesProblem({ ...base, pauses: [{ start: t("07:50"), end: t("08:10") }] })).toMatch(/inom förhöret/);
    expect(interrogationTimesProblem({ ...base, pauses: [{ start: t("09:50"), end: t("10:10") }] })).toMatch(/inom förhöret/);
    expect(interrogationTimesProblem({ ...base, pauses: [{ start: t("09:00"), end: t("09:00") }] })).toMatch(/inom förhöret/);
  });

  it("två uppehåll får inte överlappa; kant i kant går bra", () => {
    const base = { start: t("08:00"), end: t("10:00") };
    expect(interrogationTimesProblem({
      ...base, pauses: [{ start: t("09:00"), end: t("09:30") }, { start: t("09:20"), end: t("09:40") }],
    })).toMatch(/överlappa/);
    expect(interrogationTimesProblem({
      ...base, pauses: [{ start: t("09:00"), end: t("09:30") }, { start: t("09:30"), end: t("09:40") }],
    })).toBeNull();
  });
});

describe("interrogation.create + list", () => {
  it("registrerar förhör och listar ärendets förhör äldst först", async () => {
    const caller = makeCaller();
    const late = await caller.interrogation.create({ matterId: "m-1", start: t("13:00"), end: t("14:00"), pauses: [] });
    const early = await caller.interrogation.create({
      matterId: "m-1", start: t("08:00"), end: t("10:00"), pauses: [{ start: t("09:00"), end: t("09:20") }],
    });
    expect(early.organizationId).toBe("org-1");
    expect(early.pauses).toEqual([{ start: t("09:00"), end: t("09:20") }]);
    const list = await caller.interrogation.list({ matterId: "m-1" });
    expect(list.map((r) => r.id)).toEqual([early.id, late.id]);
  });

  it("uppehållen är valfria (tom lista)", async () => {
    const caller = makeCaller();
    const r = await caller.interrogation.create({ matterId: "m-1", start: t("08:00"), end: t("09:00") });
    expect(r.pauses).toEqual([]);
  });

  it("annan byrås ärende → NOT_FOUND", async () => {
    const caller = makeCaller();
    await expect(caller.interrogation.create({ matterId: "m-foreign", start: t("08:00"), end: t("09:00"), pauses: [] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("slut före början eller uppehåll utanför → BAD_REQUEST", async () => {
    const caller = makeCaller();
    await expect(caller.interrogation.create({ matterId: "m-1", start: t("10:00"), end: t("09:00"), pauses: [] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.interrogation.create({
      matterId: "m-1", start: t("08:00"), end: t("09:00"), pauses: [{ start: t("08:50"), end: t("09:10") }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("interrogation.update", () => {
  it("ändrar tiderna och prövar reglerna mot raden som den blir", async () => {
    const caller = makeCaller();
    const r = await caller.interrogation.create({ matterId: "m-1", start: t("08:00"), end: t("10:00"), pauses: [] });
    const u = await caller.interrogation.update({ id: r.id, pauses: [{ start: t("08:30"), end: t("08:50") }] });
    expect(u.pauses).toEqual([{ start: t("08:30"), end: t("08:50") }]);
    expect(new Date(u.end).toISOString()).toBe(t("10:00"));
    // Nytt slut före ett befintligt uppehåll → uppehållet hamnar utanför.
    await expect(caller.interrogation.update({ id: r.id, end: t("08:40") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const moved = await caller.interrogation.update({ id: r.id, start: t("08:10"), end: t("11:00") });
    expect(new Date(moved.start).toISOString()).toBe(t("08:10"));
    expect(new Date(moved.end).toISOString()).toBe(t("11:00"));
  });

  it("annan byrås förhör → NOT_FOUND", async () => {
    const caller = makeCaller(true);
    await expect(caller.interrogation.update({ id: "i-foreign", end: t("09:30") })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("interrogation.delete", () => {
  it("tar bort mjukt: förhöret syns inte längre", async () => {
    const caller = makeCaller();
    const r = await caller.interrogation.create({ matterId: "m-1", start: t("08:00"), end: t("09:00"), pauses: [] });
    expect(await caller.interrogation.delete({ id: r.id })).toEqual({ id: r.id });
    expect(await caller.interrogation.list({ matterId: "m-1" })).toEqual([]);
    await expect(caller.interrogation.update({ id: r.id, end: t("09:30") })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("annan byrås förhör → NOT_FOUND", async () => {
    const caller = makeCaller(true);
    await expect(caller.interrogation.delete({ id: "i-foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
