/**
 * Lease-procedurer (ADR 0033 §2) — acquire/renew/release/takeover/get över en
 * riktig InMemoryLeaseStore. Verifierar hållar-identitet (ctx.user), org-scope
 * och två-användar-interaktion (en delad store).
 */

import { describe, it, expect } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { InMemoryLeaseStore } from "@/lib/server/lease/lease-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { prebakeJoins } from "@/lib/shared/demo-source";

const ORG = "org-a";

function makeStore(): { source: DemoSource; lease: InMemoryLeaseStore } {
  const source = prebakeJoins({
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documents: [{ id: "d1", matterId: "m1", fileName: "avtal.docx" }],
  } as DemoSource);
  return { source, lease: new InMemoryLeaseStore() };
}

function caller(source: DemoSource, lease: InMemoryLeaseStore, user: { id: string; name: string }, orgId = ORG) {
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store);
  const ctx = {
    user: { id: user.id, email: `${user.id}@b.se`, name: user.name, role: "LAWYER", organizationId: orgId },
    dataStore: store, repos, orgId, ports: { lease },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return documentRouter.createCaller(ctx as any);
}

describe("document lease-procedurer", () => {
  it("acquire sätter hållaren till inloggad principal (id + namn)", async () => {
    const { source, lease } = makeStore();
    const res = await caller(source, lease, { id: "u1", name: "Anna" }).acquireLease({ documentId: "d1" });
    expect(res.acquired).toBe(true);
    expect(res.lease).toMatchObject({ holderId: "u1", holderName: "Anna" });
  });

  it("andra användaren ser acquired:false + Annas lease", async () => {
    const { source, lease } = makeStore();
    await caller(source, lease, { id: "u1", name: "Anna" }).acquireLease({ documentId: "d1" });
    const res = await caller(source, lease, { id: "u2", name: "Bo" }).acquireLease({ documentId: "d1" });
    expect(res.acquired).toBe(false);
    expect(res.lease.holderName).toBe("Anna");
  });

  it("renew från hållaren → true; från annan → false", async () => {
    const { source, lease } = makeStore();
    await caller(source, lease, { id: "u1", name: "Anna" }).acquireLease({ documentId: "d1" });
    expect((await caller(source, lease, { id: "u1", name: "Anna" }).renewLease({ documentId: "d1" })).renewed).toBe(true);
    expect((await caller(source, lease, { id: "u2", name: "Bo" }).renewLease({ documentId: "d1" })).renewed).toBe(false);
  });

  it("release frigör; getLease → null efteråt", async () => {
    const { source, lease } = makeStore();
    await caller(source, lease, { id: "u1", name: "Anna" }).acquireLease({ documentId: "d1" });
    await caller(source, lease, { id: "u1", name: "Anna" }).releaseLease({ documentId: "d1" });
    expect((await caller(source, lease, { id: "u1", name: "Anna" }).getLease({ documentId: "d1" })).lease).toBeNull();
  });

  it("takeover ger leasen till anroparen (Bo tar över Annas)", async () => {
    const { source, lease } = makeStore();
    await caller(source, lease, { id: "u1", name: "Anna" }).acquireLease({ documentId: "d1" });
    const taken = await caller(source, lease, { id: "u2", name: "Bo" }).takeoverLease({ documentId: "d1" });
    expect(taken.holderId).toBe("u2");
    expect((await caller(source, lease, { id: "u1", name: "Anna" }).renewLease({ documentId: "d1" })).renewed).toBe(false);
  });

  it("org-scope: dokument i annan org → NOT_FOUND, ingen lease tas", async () => {
    const { source, lease } = makeStore();
    await expect(
      caller(source, lease, { id: "x", name: "X" }, "org-b").acquireLease({ documentId: "d1" }),
    ).rejects.toThrow();
    expect(lease.get("d1")).toBeNull();
  });
});
