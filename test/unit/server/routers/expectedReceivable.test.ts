/**
 * Integrationstest för expectedReceivableRouter (#173) — förväntade
 * domstolsbetalningar utan faktura. Kör mot riktig DemoDataStore (verifierar
 * entitets-wiringen) via createCaller.
 */

import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = { id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1") };

function makeCaller() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå" }, { id: "org-2", name: "Annan" }],
    matters: [
      { id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Brottmål", status: "ACTIVE", createdAt: new Date() },
      { id: "m-foreign", organizationId: "org-2", matterNumber: "2026-0002", title: "U", status: "ACTIVE", createdAt: new Date() },
    ],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
  }, async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}

describe("expectedReceivable.create + list", () => {
  it("registrerar en fordran (PENDING) kopplad till ärende", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({
      matterId: "m-1",
      description: "Kostnadsräkning Svea HovR mål B 1234-26",
      expectedAmount: 50_000,
    });
    expect(r.status).toBe("PENDING");
    expect(r.expectedAmount).toBe(50_000);
    expect(r.settledAmount == null).toBe(true);

    const list = await caller.expectedReceivable.list({ matterId: "m-1" });
    expect(list).toHaveLength(1);
    expect(list[0]!.description).toContain("B 1234-26");
  });

  it("nekar fordran mot ärende i annan org (NOT_FOUND)", async () => {
    const caller = makeCaller();
    await expect(
      caller.expectedReceivable.create({ matterId: "m-foreign", description: "X", expectedAmount: 1 }),
    ).rejects.toThrow();
  });
});

describe("expectedReceivable.settle", () => {
  it("bokar faktiskt utbetalt (3b-ii): SETTLED + settledAmount, skild från expected", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({ matterId: "m-1", description: "K", expectedAmount: 50_000 });

    // Domstolen prutade: begärt 50 000, betalt 42 000.
    const settled = await caller.expectedReceivable.settle({ id: String(r.id), settledAmount: 42_000, paymentReference: "camt-xyz" });
    expect(settled.status).toBe("SETTLED");
    expect(settled.settledAmount).toBe(42_000);
    expect(settled.expectedAmount).toBe(50_000); // memo oförändrat — prutning bokförs ej som förlust
    expect(settled.settledAt).toBeTruthy();
    expect(settled.paymentReference).toBe("camt-xyz");
  });
});

describe("expectedReceivable.cancel", () => {
  it("avbryter en fordran", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({ matterId: "m-1", description: "K", expectedAmount: 10_000 });
    const c = await caller.expectedReceivable.cancel({ id: String(r.id) });
    expect(c.status).toBe("CANCELLED");
  });
});

describe("expectedReceivable.candidates (#175 camt-matchning)", () => {
  it("returnerar bara PENDING + berikar med ärende-/målnummer", async () => {
    const caller = makeCaller();
    // Sätt målnummer på ärendet (matchningsnyckeln).
    await caller.matter.update({ id: "m-1", courtCaseNumber: "B 1234-26" });
    const pending = await caller.expectedReceivable.create({ matterId: "m-1", description: "Öppen", expectedAmount: 50_000 });
    const settledOne = await caller.expectedReceivable.create({ matterId: "m-1", description: "Avprickad", expectedAmount: 30_000 });
    await caller.expectedReceivable.settle({ id: String(settledOne.id), settledAmount: 30_000 });

    const cands = await caller.expectedReceivable.candidates();
    expect(cands).toHaveLength(1); // bara den PENDING
    expect(cands[0]!.id).toBe(String(pending.id));
    expect(cands[0]!.matterNumber).toBe("2026-0001");
    expect(cands[0]!.courtCaseNumber).toBe("B 1234-26");
    expect(cands[0]!.expectedAmount).toBe(50_000);
  });
});

describe("expectedReceivable.update", () => {
  it("uppdaterar memo-fält (beskrivning + begärt belopp)", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({ matterId: "m-1", description: "Gammal", expectedAmount: 10_000 });
    const u = await caller.expectedReceivable.update({ id: String(r.id), description: "Ny", expectedAmount: 12_000 });
    expect(u.description).toBe("Ny");
    expect(u.expectedAmount).toBe(12_000);
  });

  it("NOT_FOUND för fordran i annan org", async () => {
    const caller = makeCaller();
    await expect(caller.expectedReceivable.update({ id: "nope", description: "X" })).rejects.toThrow();
  });
});
